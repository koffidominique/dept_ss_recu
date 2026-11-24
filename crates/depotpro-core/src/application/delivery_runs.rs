//! Tournees de livraison — socle (Lot 13).
//!
//! Une tournee est un chargement qui part et revient. Ce n'est PAS une caisse :
//! l'argent encaisse sur le terrain reste en transit jusqu'a la reconciliation,
//! ou il rejoint la session de caisse du depot (Lot 14).
//!
//! Regles cles :
//! - Les montants attendus sont FIGES au chargement (`load_run`). Sans cela, une
//!   commande annulee pendant la tournee modifierait l'attendu apres coup et
//!   l'ecart du soir serait faux. Meme principe que `deposit_issues.unit_value`.
//! - Les declarations du livreur (`delivery_run_collections`) n'ecrivent AUCUN
//!   mouvement de caisse : declarer n'est pas comptabiliser.
//! - Toutes les transitions sont idempotentes par `opened_key` / `closed_key`,
//!   sur le modele de `cash_sessions`.
//! - Ce module ne fait que le socle : creation, chargement, depart, annulation.
//!   La reconciliation est le Lot 14.

use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryRunDto {
    pub id: i64,
    pub reference: String,
    pub run_date: String,
    pub driver_user_id: i64,
    pub driver_name: String,
    pub vehicle_label: Option<String>,
    pub status: String,
    pub planned_stops: i64,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryRunStopDto {
    pub id: i64,
    pub run_id: i64,
    pub client_id: i64,
    pub client_name: String,
    pub order_id: Option<i64>,
    pub sequence: i64,
    pub expected_amount: i64,
    pub expected_empty_pieces: i64,
    pub status: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryRunDetailDto {
    pub run: DeliveryRunDto,
    pub stops: Vec<DeliveryRunStopDto>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRunInput {
    pub run_date: String,
    pub driver_user_id: i64,
    pub vehicle_label: Option<String>,
    pub request_key: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddStopInput {
    pub client_id: i64,
    pub order_id: Option<i64>,
    pub sequence: Option<i64>,
}

/// Statuts depuis lesquels une tournee peut encore etre modifiee.
fn is_editable(status: &str) -> bool {
    matches!(status, "draft" | "loaded")
}

/// Cree une tournee au statut `draft`. Idempotent par `request_key`.
pub async fn create_run(db: &DepotDb, input: CreateRunInput) -> CoreResult<DeliveryRunDto> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    if input.run_date.trim().is_empty() {
        return Err(CoreError::Validation(
            "La date de tournee est obligatoire.".to_string(),
        ));
    }
    let request_key = input
        .request_key
        .filter(|k| !k.trim().is_empty())
        .unwrap_or_else(|| format!("dr-create:{}", uuid::Uuid::new_v4()));

    let (_guard, mut tx) = db.begin_write().await?;

    // Idempotence : rejouer la meme requete renvoie la tournee existante.
    if let Some(existing) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM delivery_runs WHERE opened_key = ?",
    )
    .bind(&request_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        let dto = load_run_tx(&mut tx, existing).await?;
        tx.commit().await?;
        return Ok(dto);
    }

    // Le livreur doit exister et porter le role attendu : une tournee rattachee
    // a un caissier serait une erreur de saisie couteuse a decouvrir plus tard.
    let driver_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ? AND active = 1")
            .bind(input.driver_user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let driver_role = driver_role.ok_or_else(|| {
        CoreError::Validation("Livreur introuvable ou inactif.".to_string())
    })?;
    if driver_role != "driver" {
        return Err(CoreError::Validation(format!(
            "L'utilisateur designe n'a pas le role livreur (role actuel : {driver_role})."
        )));
    }

    let reference = next_run_reference_tx(&mut tx).await?;
    let id = sqlx::query(
        "INSERT INTO delivery_runs
            (reference, run_date, driver_user_id, vehicle_label, status, opened_key, notes)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)",
    )
    .bind(&reference)
    .bind(&input.run_date)
    .bind(input.driver_user_id)
    .bind(&input.vehicle_label)
    .bind(&request_key)
    .bind(&input.notes)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    let dto = load_run_tx(&mut tx, id).await?;
    tx.commit().await?;
    Ok(dto)
}

/// Ajoute un arret a une tournee encore modifiable.
pub async fn add_stop(
    db: &DepotDb,
    run_id: i64,
    input: AddStopInput,
) -> CoreResult<DeliveryRunDetailDto> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    let (_guard, mut tx) = db.begin_write().await?;

    let status = run_status_tx(&mut tx, run_id).await?;
    if !is_editable(&status) {
        return Err(CoreError::Validation(format!(
            "La tournee est au statut {status} : ses arrets ne peuvent plus etre modifies."
        )));
    }

    let client_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clients WHERE id = ?")
        .bind(input.client_id)
        .fetch_one(&mut *tx)
        .await?;
    if client_exists == 0 {
        return Err(CoreError::Validation("Client introuvable.".to_string()));
    }

    // La commande, si fournie, doit appartenir au client : sans ce controle une
    // tournee pourrait livrer la commande d'un autre client.
    if let Some(order_id) = input.order_id {
        let owner: Option<i64> = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id = ?")
            .bind(order_id)
            .fetch_optional(&mut *tx)
            .await?;
        match owner {
            None => {
                return Err(CoreError::Validation("Commande introuvable.".to_string()));
            }
            Some(oid) if oid != input.client_id => {
                return Err(CoreError::Validation(
                    "La commande n'appartient pas au client de cet arret.".to_string(),
                ));
            }
            _ => {}
        }
    }

    let sequence = match input.sequence {
        Some(s) if s > 0 => s,
        _ => {
            let max: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sequence), 0) FROM delivery_run_stops WHERE run_id = ?",
            )
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await?;
            max + 1
        }
    };

    let taken: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM delivery_run_stops WHERE run_id = ? AND sequence = ?",
    )
    .bind(run_id)
    .bind(sequence)
    .fetch_one(&mut *tx)
    .await?;
    if taken > 0 {
        return Err(CoreError::Validation(format!(
            "L'ordre de passage {sequence} est deja utilise sur cette tournee."
        )));
    }

    sqlx::query(
        "INSERT INTO delivery_run_stops (run_id, client_id, order_id, sequence, status)
         VALUES (?, ?, ?, ?, 'planned')",
    )
    .bind(run_id)
    .bind(input.client_id)
    .bind(input.order_id)
    .bind(sequence)
    .execute(&mut *tx)
    .await?;

    let detail = load_run_detail_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(detail)
}

/// Charge la tournee : fige les montants attendus, passe en `loaded`.
///
/// C'est ici que le snapshot est pris. Apres cet appel, les montants attendus
/// ne changent plus, quelle que soit l'evolution des commandes.
pub async fn load_run(db: &DepotDb, run_id: i64) -> CoreResult<DeliveryRunDetailDto> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    let (_guard, mut tx) = db.begin_write().await?;

    let status = run_status_tx(&mut tx, run_id).await?;
    if status == "loaded" || status == "in_progress" || status == "returned" {
        // Idempotent : recharger une tournee deja chargee ne refige pas le
        // snapshot (sinon les corrections du soir seraient perdues).
        let detail = load_run_detail_tx(&mut tx, run_id).await?;
        tx.commit().await?;
        return Ok(detail);
    }
    if status != "draft" {
        return Err(CoreError::Validation(format!(
            "Une tournee au statut {status} ne peut pas etre chargee."
        )));
    }

    let stops = stop_ids_tx(&mut tx, run_id).await?;
    if stops.is_empty() {
        return Err(CoreError::Validation(
            "Une tournee doit avoir au moins un arret avant d'etre chargee.".to_string(),
        ));
    }

    for stop_id in stops {
        // Montant attendu = reste a payer des commandes livrees de cet arret.
        // On lit `orders.total_to_collect_xof - orders.paid_xof`, borne a 0.
        // L'alias explicite `s` est indispensable : sans lui, la sous-requete
        // `WHERE id = order_id` resout `id` vers la sous-requete elle-meme
        // (toujours la premiere ligne) au lieu de l'arret courant.
        let (_order_id, expected): (Option<i64>, i64) = sqlx::query_as(
            "SELECT s.order_id,
                    CASE WHEN s.order_id IS NULL THEN 0
                         ELSE MAX(0, COALESCE((SELECT o.total_to_collect_xof - o.paid_xof
                                               FROM orders o WHERE o.id = s.order_id), 0))
                    END
             FROM delivery_run_stops s WHERE s.id = ?",
        )
        .bind(stop_id)
        .fetch_one(&mut *tx)
        .await?;

        // Vides attendus = consignes ouvertes du client a cet instant.
        let client_id: i64 =
            sqlx::query_scalar("SELECT client_id FROM delivery_run_stops WHERE id = ?")
                .bind(stop_id)
                .fetch_one(&mut *tx)
                .await?;
        let empty_pieces: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(pieces - returned_pieces - converted_pieces - lost_pieces), 0)
             FROM deposit_issues
             WHERE client_id = ? AND status IN ('pending', 'partially_returned')",
        )
        .bind(client_id)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE delivery_run_stops
             SET expected_amount = ?, expected_empty_pieces = ?
             WHERE id = ?",
        )
        .bind(expected)
        .bind(empty_pieces.max(0))
        .bind(stop_id)
        .execute(&mut *tx)
        .await?;
    }

    let planned: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM delivery_run_stops WHERE run_id = ?")
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await?;

    sqlx::query("UPDATE delivery_runs SET status = 'loaded', planned_stops = ? WHERE id = ?")
        .bind(planned)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

    let detail = load_run_detail_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(detail)
}

/// Depart de la tournee : `loaded` -> `in_progress`.
pub async fn start_run(db: &DepotDb, run_id: i64) -> CoreResult<DeliveryRunDto> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let status = run_status_tx(&mut tx, run_id).await?;
    if status == "in_progress" {
        let dto = load_run_tx(&mut tx, run_id).await?;
        tx.commit().await?;
        return Ok(dto);
    }
    if status != "loaded" {
        return Err(CoreError::Validation(format!(
            "Une tournee doit etre chargee avant le depart (statut actuel : {status})."
        )));
    }
    sqlx::query("UPDATE delivery_runs SET status = 'in_progress' WHERE id = ?")
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
    let dto = load_run_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(dto)
}

/// Annule une tournee. Refuse si elle est deja revenue : une tournee revenue
/// porte des montants constates, l'annulation effacerait une realite.
pub async fn cancel_run(db: &DepotDb, run_id: i64, closed_key: Option<String>) -> CoreResult<DeliveryRunDto> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let status = run_status_tx(&mut tx, run_id).await?;
    if status == "cancelled" {
        let dto = load_run_tx(&mut tx, run_id).await?;
        tx.commit().await?;
        return Ok(dto);
    }
    if !matches!(status.as_str(), "draft" | "loaded" | "in_progress") {
        return Err(CoreError::Validation(format!(
            "Une tournee au statut {status} ne peut pas etre annulee : elle porte deja des constats."
        )));
    }
    let key = closed_key
        .filter(|k| !k.trim().is_empty())
        .unwrap_or_else(|| format!("dr-cancel:{run_id}"));
    sqlx::query(
        "UPDATE delivery_runs
         SET status = 'cancelled', closed_key = ?, closed_at = datetime('now')
         WHERE id = ?",
    )
    .bind(&key)
    .bind(run_id)
    .execute(&mut *tx)
    .await?;
    let dto = load_run_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(dto)
}

pub async fn get_run(db: &DepotDb, run_id: i64) -> CoreResult<DeliveryRunDetailDto> {
    require_current_actor_permission(Permission::DeliveryRunsRead)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let detail = load_run_detail_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(detail)
}

pub async fn list_runs(db: &DepotDb) -> CoreResult<Vec<DeliveryRunDto>> {
    require_current_actor_permission(Permission::DeliveryRunsRead)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let rows = sqlx::query(
        "SELECT dr.id, dr.reference, dr.run_date, dr.driver_user_id, u.display_name AS driver_name,
                dr.vehicle_label, dr.status, dr.planned_stops, dr.opened_at, dr.closed_at, dr.notes
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         ORDER BY dr.run_date DESC, dr.id DESC",
    )
    .fetch_all(&mut *tx)
    .await?;
    let out = rows.iter().map(run_from_row).collect::<Result<Vec<_>, _>>()?;
    tx.commit().await?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn run_from_row(row: &sqlx::sqlite::SqliteRow) -> CoreResult<DeliveryRunDto> {
    Ok(DeliveryRunDto {
        id: row.try_get("id")?,
        reference: row.try_get("reference")?,
        run_date: row.try_get("run_date")?,
        driver_user_id: row.try_get("driver_user_id")?,
        driver_name: row.try_get("driver_name")?,
        vehicle_label: row.try_get("vehicle_label")?,
        status: row.try_get("status")?,
        planned_stops: row.try_get("planned_stops")?,
        opened_at: row.try_get("opened_at")?,
        closed_at: row.try_get("closed_at")?,
        notes: row.try_get("notes")?,
    })
}

async fn next_run_reference_tx(tx: &mut Transaction<'_, Sqlite>) -> CoreResult<String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM delivery_runs")
        .fetch_one(&mut **tx)
        .await?;
    Ok(format!("TRN-{:06}", count + 1))
}

async fn run_status_tx(tx: &mut Transaction<'_, Sqlite>, run_id: i64) -> CoreResult<String> {
    sqlx::query_scalar("SELECT status FROM delivery_runs WHERE id = ?")
        .bind(run_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| CoreError::NotFound("Tournee introuvable.".to_string()))
}

async fn stop_ids_tx(tx: &mut Transaction<'_, Sqlite>, run_id: i64) -> CoreResult<Vec<i64>> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM delivery_run_stops WHERE run_id = ? ORDER BY sequence",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await?)
}

async fn load_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: i64,
) -> CoreResult<DeliveryRunDto> {
    let row = sqlx::query(
        "SELECT dr.id, dr.reference, dr.run_date, dr.driver_user_id, u.display_name AS driver_name,
                dr.vehicle_label, dr.status, dr.planned_stops, dr.opened_at, dr.closed_at, dr.notes
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         WHERE dr.id = ?",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::NotFound("Tournee introuvable.".to_string()))?;
    run_from_row(&row)
}

async fn load_run_detail_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: i64,
) -> CoreResult<DeliveryRunDetailDto> {
    let run = load_run_tx(tx, run_id).await?;
    let rows = sqlx::query(
        "SELECT s.id, s.run_id, s.client_id, c.name AS client_name, s.order_id, s.sequence,
                s.expected_amount, s.expected_empty_pieces, s.status, s.failure_reason
         FROM delivery_run_stops s
         JOIN clients c ON c.id = s.client_id
         WHERE s.run_id = ?
         ORDER BY s.sequence",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut stops = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        stops.push(DeliveryRunStopDto {
            id: row.try_get("id")?,
            run_id: row.try_get("run_id")?,
            client_id: row.try_get("client_id")?,
            client_name: row.try_get("client_name")?,
            order_id: row.try_get("order_id")?,
            sequence: row.try_get("sequence")?,
            expected_amount: row.try_get("expected_amount")?,
            expected_empty_pieces: row.try_get("expected_empty_pieces")?,
            status: row.try_get("status")?,
            failure_reason: row.try_get("failure_reason")?,
        });
    }
    Ok(DeliveryRunDetailDto { run, stops })
}
