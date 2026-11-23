// ============================================================================
// Déclarations de perte et validation en créance financière
// ============================================================================

use serde::Serialize;
use sqlx::FromRow;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{insert_ledger_entry, mark_converted, DeclareLossInput};

#[derive(Debug, Serialize, FromRow)]
pub struct PackagingLossDeclarationDto {
    pub id: i64,
    pub request_key: String,
    pub deposit_issue_id: i64,
    pub sale_reference: Option<String>,
    pub client_id: Option<i64>,
    pub client_name: Option<String>,
    pub packaging_name: String,
    pub pieces: i64,
    pub unit_value: i64,
    pub estimated_amount: i64,
    pub status: String,
    pub reason: String,
    pub created_at: String,
}

/// Liste les déclarations de perte d'emballages (filtrable par client).
pub async fn list_loss_declarations(
    db: &DepotDb,
    client_id: Option<i64>,
) -> CoreResult<Vec<PackagingLossDeclarationDto>> {
    let sql_base = "SELECT pld.id, pld.request_key, pld.deposit_issue_id,
                           s.reference AS sale_reference, pld.client_id,
                           c.name AS client_name,
                           COALESCE(rpt.name, '#' || di.returnable_id) AS packaging_name,
                           pld.pieces, di.unit_value,
                           (pld.pieces * di.unit_value) AS estimated_amount,
                           pld.status, pld.reason, pld.created_at
                    FROM packaging_loss_declarations pld
                    JOIN deposit_issues di ON di.id = pld.deposit_issue_id
                    LEFT JOIN sales s ON s.id = di.sale_id
                    LEFT JOIN clients c ON c.id = pld.client_id
                    LEFT JOIN returnable_packaging_types rpt ON rpt.id = di.returnable_id";
    let rows = if let Some(cid) = client_id {
        sqlx::query_as::<_, PackagingLossDeclarationDto>(&format!(
            "{sql_base} WHERE pld.client_id = ? ORDER BY pld.id DESC"
        ))
        .bind(cid)
        .fetch_all(&db.pool)
        .await?
    } else {
        sqlx::query_as::<_, PackagingLossDeclarationDto>(&format!(
            "{sql_base} ORDER BY pld.id DESC LIMIT 200"
        ))
        .fetch_all(&db.pool)
        .await?
    };
    Ok(rows)
}

/// Déclare une perte ou destruction avant échéance. La conversion financière
/// n'est créée qu'après validation (`validate_loss_declaration`).
pub async fn declare_loss(
    db: &DepotDb,
    input: DeclareLossInput,
    actor: Option<&str>,
) -> CoreResult<i64> {
    if input.pieces <= 0 {
        return Err(CoreError::Validation(
            "La quantité déclarée doit être strictement positive.".to_string(),
        ));
    }
    if input.reason.trim().is_empty() {
        return Err(CoreError::Validation(
            "Le motif est obligatoire.".to_string(),
        ));
    }
    let mut g = db.begin_write().await?;
    let tx = &mut g.1;
    let (pieces_due, client_id, di_status): (i64, Option<i64>, String) = sqlx::query_as(
        "SELECT pieces, client_id, COALESCE(status, 'pending') FROM deposit_issues WHERE id = ?",
    )
    .bind(input.deposit_issue_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::Validation("Obligation d'emballage introuvable.".to_string()))?;
    if matches!(
        di_status.as_str(),
        "returned" | "settled" | "cancelled" | "converted"
    ) {
        return Err(CoreError::Validation(
            "Impossible de déclarer une perte sur une obligation déjà soldée ou clôturée."
                .to_string(),
        ));
    }
    let already: i64 = sqlx::query_scalar(
        "SELECT returned_pieces + lost_pieces + destroyed_pieces + converted_pieces
                + COALESCE((SELECT SUM(pieces) FROM packaging_loss_declarations
                            WHERE deposit_issue_id = ? AND status = 'declared'), 0)
         FROM deposit_issues WHERE id = ?",
    )
    .bind(input.deposit_issue_id)
    .bind(input.deposit_issue_id)
    .fetch_one(&mut **tx)
    .await?;
    let remaining_available = (pieces_due - already).max(0);
    if input.pieces > remaining_available {
        return Err(CoreError::Validation(format!(
            "Quantité déclarée supérieure au reste à restituer (max {remaining_available}).",
        )));
    }
    let request_key = DepotDb::next_sequence(tx, "DEC-PERTE").await?;
    let user_id: Option<i64> = match actor {
        Some(name) => {
            sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
                .bind(name)
                .fetch_optional(&mut **tx)
                .await?
        }
        None => None,
    };
    sqlx::query(
        "INSERT INTO packaging_loss_declarations
            (request_key, deposit_issue_id, client_id, pieces, status, reason, declared_by_user_id)
         VALUES (?, ?, ?, ?, 'declared', ?, ?)",
    )
    .bind(&request_key)
    .bind(input.deposit_issue_id)
    .bind(client_id)
    .bind(input.pieces)
    .bind(input.reason.trim())
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    let decl_id: i64 =
        sqlx::query_scalar("SELECT id FROM packaging_loss_declarations WHERE request_key = ?")
            .bind(&request_key)
            .fetch_one(&mut **tx)
            .await?;
    sqlx::query(
        "INSERT INTO audit_logs (entity_type, entity_id, action, details, actor_name)
         VALUES ('packaging_loss_declarations', ?, 'DECLARE_LOSS', ?, ?)",
    )
    .bind(decl_id.to_string())
    .bind(format!(
        "Perte déclarée : {} pièce(s) — motif : {}",
        input.pieces,
        input.reason.trim()
    ))
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    g.1.commit().await?;
    Ok(decl_id)
}

/// Valide une déclaration de perte : convertit immédiatement la quantité
/// concernée en créance financière (une seule fois).
pub async fn validate_loss_declaration(
    db: &DepotDb,
    declaration_id: i64,
    actor: Option<&str>,
) -> CoreResult<i64> {
    let mut g = db.begin_write().await?;
    let tx = &mut g.1;
    let (issue_id, pieces, client_id, status): (i64, i64, Option<i64>, String) = sqlx::query_as(
        "SELECT deposit_issue_id, pieces, client_id, status
         FROM packaging_loss_declarations WHERE id = ?",
    )
    .bind(declaration_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::Validation("Déclaration introuvable.".to_string()))?;
    if status != "declared" {
        return Err(CoreError::Validation(
            "Cette déclaration a déjà été traitée.".to_string(),
        ));
    }
    let (unit_value, returnable_id, pieces_due, already_out): (i64, i64, i64, i64) =
        sqlx::query_as(
            "SELECT unit_value, returnable_id, pieces,
                returned_pieces + lost_pieces + destroyed_pieces + converted_pieces
         FROM deposit_issues WHERE id = ?",
        )
        .bind(issue_id)
        .fetch_one(&mut **tx)
        .await?;
    if pieces > (pieces_due - already_out).max(0) {
        return Err(CoreError::Validation(
            "La quantité déclarée dépasse désormais le reliquat ouvert sur cette obligation."
                .to_string(),
        ));
    }
    let amount = pieces
        .checked_mul(unit_value)
        .ok_or_else(|| CoreError::Validation("Débordement du montant.".to_string()))?;
    let request_key = DepotDb::next_sequence(tx, "CNV-EMB").await?;
    sqlx::query(
        "INSERT INTO packaging_conversions
            (request_key, deposit_issue_id, client_id, reason, pieces,
             unit_value_snapshot, amount)
         VALUES (?, ?, ?, 'loss', ?, ?, ?)",
    )
    .bind(&request_key)
    .bind(issue_id)
    .bind(client_id)
    .bind(pieces)
    .bind(unit_value)
    .bind(amount)
    .execute(&mut **tx)
    .await?;
    let conversion_id: i64 =
        sqlx::query_scalar("SELECT id FROM packaging_conversions WHERE request_key = ?")
            .bind(&request_key)
            .fetch_one(&mut **tx)
            .await?;
    if let Some(cid) = client_id {
        insert_ledger_entry(
            tx,
            &format!("cnv:{conversion_id}"),
            cid,
            Some(conversion_id),
            "conversion_charge",
            amount,
            "debit",
            actor,
            Some(format!("Perte validée : {pieces} pièce(s).")),
        )
        .await?;
        sqlx::query(
            "UPDATE customer_packaging_accounts
             SET balance_pieces = MAX(0, balance_pieces - ?),
                 deposit_held_amount = CASE
                     WHEN balance_pieces - ? <= 0 THEN 0
                     ELSE MAX(0, deposit_held_amount - ?)
                 END
             WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(pieces)
        .bind(pieces)
        .bind(amount)
        .bind(cid)
        .bind(returnable_id)
        .execute(&mut **tx)
        .await?;
        crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
            tx,
            cid,
            returnable_id,
            -pieces,
            unit_value,
        )
        .await?;
    }
    mark_converted(tx, issue_id, pieces).await?;
    sqlx::query(
        "UPDATE packaging_loss_declarations
         SET status = 'validated', validated_by_user_id = (SELECT id FROM users WHERE username = ?),
             conversion_id = ?, updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(actor)
    .bind(conversion_id)
    .bind(declaration_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (entity_type, entity_id, action, details, actor_name)
         VALUES ('packaging_loss_declarations', ?, 'VALIDATE_LOSS', ?, ?)",
    )
    .bind(declaration_id.to_string())
    .bind(format!("Perte validée — créance créée : {amount} FCFA"))
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    g.1.commit().await?;
    Ok(amount)
}
