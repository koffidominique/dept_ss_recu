// ============================================================================
// Sessions de caisse : état, ouverture et clôture
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::application::sales::{audit_log_tx, get_theoretical_cash_tx};
use crate::domain::money::Money;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{
    CashMovementDto, CashSessionDto, CashStatusDto, CashSummaryDto, CloseCashInput,
    MethodSummaryDto, OpenCashInput, RunInTransitDto,
};

pub async fn get_cash_status(db: &DepotDb) -> CoreResult<CashStatusDto> {
    require_current_actor_permission(Permission::CashRead)?;
    let active_session = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE status = 'open' LIMIT 1",
    )
    .fetch_optional(&db.pool)
    .await?;

    let mut summary = None;

    if let Some(ref s) = active_session {
        let net_cash: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
             FROM cash_movements WHERE session_id = ? AND method_code = 'cash'",
        )
        .bind(s.id)
        .fetch_one(&db.pool)
        .await?;
        let theoretical_cash = Money(s.opening_cash)
            .checked_add(Money(net_cash), "Solde théorique caisse")?
            .value();

        let by_method = sqlx::query_as::<_, MethodSummaryDto>(
            "SELECT cm.method_code, pm.label, pm.is_cash,
                    COALESCE(SUM(CASE WHEN cm.direction = 'in' THEN cm.amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN cm.direction = 'out' THEN cm.amount ELSE 0 END), 0) AS total_out
             FROM cash_movements cm
             JOIN payment_methods pm ON pm.code = cm.method_code
             WHERE cm.session_id = ?
             GROUP BY cm.method_code, pm.label, pm.is_cash",
        )
        .bind(s.id)
        .fetch_all(&db.pool)
        .await?;

        let movements = sqlx::query_as::<_, CashMovementDto>(
            "SELECT cm.id, cm.kind, cm.method_code, pm.label AS method_label, pm.is_cash,
                    cm.direction, cm.amount, cm.description, cm.reference_document, cm.created_at
             FROM cash_movements cm
             JOIN payment_methods pm ON pm.code = cm.method_code
             WHERE cm.session_id = ?
             ORDER BY cm.id DESC LIMIT 100",
        )
        .bind(s.id)
        .fetch_all(&db.pool)
        .await?;

        summary = Some(CashSummaryDto {
            theoretical_cash,
            by_method,
            movements,
        });
    }

    let history = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE status = 'closed' ORDER BY id DESC LIMIT 30",
    )
    .fetch_all(&db.pool)
    .await?;

    // Argent en transit : les encaissements déclarés par les livreurs.
    //
    // Sans ce bloc, ces montants n'existaient nulle part hors de la
    // réconciliation : ni en caisse (à raison — les compter rendrait le tiroir
    // faux), ni dans aucun écran. Un gérant qui se demande « où est passé
    // l'argent encaissé ce matin ? » n'avait aucune réponse.
    //
    // Toujours calculé, même sans session ouverte : une tournée peut être sur
    // la route avant que le tiroir ne le soit.
    let runs_in_transit = sqlx::query_as::<_, RunInTransitDto>(
        // ATTENTION, verifie a la duree : `FromRow` lit le nom **SQL** de la
        // colonne, pas le nom Rust. Avec `rename_all = "camelCase"`, le nom
        // Rust est `run_id`, donc l'alias SQL doit rester `run_id` ; mettre
        // `AS run_id` echoue a l'execution avec « no column found for name:
        // run_id », et pas a la compilation.
        //
        // Le `rename_all` ne concerne QUE la serialisation JSON envoyee au
        // front, ou les champs sortent bien en camelCase.
        "SELECT dr.id AS run_id,
                dr.reference AS reference,
                dr.run_date AS run_date,
                u.display_name AS driver_name,
                dr.status AS status,
                COALESCE((SELECT SUM(c.amount)
                          FROM delivery_run_collections c
                          JOIN delivery_run_stops s ON s.id = c.stop_id
                          WHERE s.run_id = dr.id AND s.status = 'delivered'), 0)
                    AS declared_amount,
                COALESCE((SELECT SUM(s.expected_amount)
                          FROM delivery_run_stops s
                          WHERE s.run_id = dr.id AND s.status = 'delivered'), 0)
                    AS expected_amount,
                COALESCE((SELECT COUNT(DISTINCT s.id)
                          FROM delivery_run_collections c
                          JOIN delivery_run_stops s ON s.id = c.stop_id
                          WHERE s.run_id = dr.id AND s.status = 'delivered'), 0)
                    AS declared_stops,
                (SELECT COUNT(*) FROM delivery_run_stops s WHERE s.run_id = dr.id)
                    AS planned_stops
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         WHERE dr.status = 'in_progress'
         ORDER BY dr.run_date DESC, dr.id DESC",
    )
    .fetch_all(&db.pool)
    .await?;

    Ok(CashStatusDto {
        active_session,
        summary,
        history,
        runs_in_transit,
    })
}

pub async fn open_cash_session(db: &DepotDb, input: OpenCashInput) -> CoreResult<CashSessionDto> {
    require_current_actor_permission(Permission::CashOperate)?;
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    let opening_cash = Money::from_non_negative(input.opening_cash, "Fond de caisse initial")?;
    let (_guard, mut tx) = db.begin_write().await?;

    if let Some(dup) = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE opening_key = ?",
    )
    .bind(&request_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.rollback().await?;
        return Ok(dup);
    }

    if sqlx::query_scalar::<_, i64>("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")
        .fetch_optional(&mut *tx)
        .await?
        .is_some()
    {
        return Err(CoreError::SessionAlreadyOpen(
            "Une session de caisse est déjà ouverte.".to_string(),
        ));
    }

    let reference = DepotDb::next_sequence(&mut tx, "CAI").await?;
    let id = sqlx::query(
        "INSERT INTO cash_sessions (reference, opening_key, status, opening_cash) VALUES (?, ?, 'open', ?)",
    )
    .bind(&reference)
    .bind(&request_key)
    .bind(opening_cash.value())
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    audit_log_tx(
        &mut tx,
        "OPEN_CASH",
        "cash_sessions",
        Some(id.to_string()),
        &format!("Ouverture {reference} — Fond {} FCFA", opening_cash.value()),
    )
    .await?;
    tx.commit().await?;

    let created = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await?;
    Ok(created)
}

pub async fn close_cash_session(db: &DepotDb, input: CloseCashInput) -> CoreResult<CashSessionDto> {
    require_current_actor_permission(Permission::CashOperate)?;
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    let physical_cash = Money::from_non_negative(input.physical_cash, "Montant physique compté")?;
    let notes = input.closing_notes.as_deref().map(str::trim).unwrap_or("");

    let (_guard, mut tx) = db.begin_write().await?;
    if let Some(dup) = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE closing_key = ?",
    )
    .bind(&request_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.rollback().await?;
        if dup.id != input.session_id {
            return Err(CoreError::DuplicateOperation(
                "Cette clé d'idempotence a déjà été utilisée pour une autre session.".to_string(),
            ));
        }
        return Ok(dup);
    }

    let s: Option<(i64, String, i64)> = sqlx::query_as(
        "SELECT id, reference, opening_cash FROM cash_sessions WHERE id = ? AND status = 'open'",
    )
    .bind(input.session_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (sid, sref, opening_cash) =
        s.ok_or_else(|| CoreError::SessionNotOpen("Session ouverte introuvable.".to_string()))?;

    let theoretical = get_theoretical_cash_tx(&mut tx, sid, opening_cash).await?;
    let difference = physical_cash
        .checked_sub(Money(theoretical), "Écart de clôture")?
        .value();
    if difference != 0 && notes.is_empty() {
        return Err(CoreError::Validation(format!(
            "Un écart de caisse ({difference} FCFA) nécessite obligatoirement un commentaire justificatif."
        )));
    }

    sqlx::query(
        "UPDATE cash_sessions
         SET status = 'closed', closing_key = ?, closed_at = datetime('now'),
             theoretical_cash = ?, physical_cash = ?, difference = ?, closing_notes = ?
         WHERE id = ?",
    )
    .bind(&request_key)
    .bind(theoretical)
    .bind(physical_cash.value())
    .bind(difference)
    .bind(if notes.is_empty() { None } else { Some(notes) })
    .bind(sid)
    .execute(&mut *tx)
    .await?;

    audit_log_tx(
        &mut tx,
        "CLOSE_CASH",
        "cash_sessions",
        Some(sid.to_string()),
        &format!(
            "Clôture {sref} — Théorique {theoretical} / Physique {} / Écart {difference}",
            physical_cash.value()
        ),
    )
    .await?;
    tx.commit().await?;

    let closed = sqlx::query_as::<_, CashSessionDto>(
        "SELECT id, reference, opened_at, closed_at, status, opening_cash, theoretical_cash, physical_cash, difference, closing_notes
         FROM cash_sessions WHERE id = ?",
    )
    .bind(sid)
    .fetch_one(&db.pool)
    .await?;
    Ok(closed)
}
