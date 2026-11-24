// ============================================================================
// Réconciliation des tournées de livraison (Lot 14)
// ============================================================================

//! Le moment où l'argent du terrain devient de l'argent du dépôt.
//!
//! Trois temps, et un seul écrit la comptabilité :
//!
//! ```text
//! ① DÉCLARATION  le livreur saisit ce qu'il a encaissé, par moyen de paiement.
//!                Aucun mouvement de caisse. Une déclaration n'est pas une
//!                comptabilisation.
//! ② RETOUR       le gérant dit ce qu'il a *observé* au retour : quels arrêts
//!                ont été livrés, combien de vides sont revenus et *chez qui*.
//!                Toujours rien en caisse.
//! ③ RÉCONCILIATION  le gérant compte. C'est ici, et seulement ici, que les
//!                `cash_movements` sont écrits, rattachés à la session de
//!                caisse ouverte du dépôt.
//! ```
//!
//! La raison de ce découpage : `cash_sessions.theoretical_cash` reste exact en
//! permanence. Rien n'entre avant le retour, donc l'écart est mesuré au bon
//! endroit — entre ce que le livreur dit et ce qu'il rend — et non entre deux
//! totaux qui se compensent.
//!
//! Trois décisions méritent d'être explicitées :
//!
//! - **L'attendu ne compte que les arrêts livrés.** Un arrêt `failed` ou
//!   `skipped` n'a rien produit : l'inclure fabriquerait un manquant imaginaire.
//! - **Les vides sont déclarés par client, pas en FIFO global.** Le livreur sait
//!   chez qui il reprend. Répartir entre tous les clients de la tournée
//!   solderait la dette d'un client avec les casiers d'un autre.
//! - **Un manquant d'argent est une perte constatée le jour même** ; un manque
//!   de vides n'est PAS une perte : le client détient peut-être encore ses
//!   casiers. On laisse donc la consigne ouverte plutôt que d'inventer un vol.

use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::application::packaging_returns::settle_deposit_issues_tx;
use crate::application::sales::require_open_session_tx;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DeclareCollectionInput {
    pub stop_id: i64,
    pub method_code: String,
    pub amount: i64,
}

#[derive(Debug, Deserialize)]
pub struct RecordStopOutcomeInput {
    pub stop_id: i64,
    /// `delivered`, `failed` ou `skipped`.
    pub status: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReturnAllocationInput {
    pub client_id: i64,
    pub returnable_id: i64,
    pub good_pieces: i64,
    pub damaged_pieces: i64,
}

#[derive(Debug, Deserialize)]
pub struct RecordRunReturnInput {
    /// Vides rapportés, par consignable, tous clients confondus.
    pub returns: Vec<RunReturnInput>,
    /// Chez qui ces vides ont été repris. La somme par consignable doit égaler
    /// exactement ce qui est rapporté : sinon le stock de vides bougerait sans
    /// contrepartie.
    pub allocations: Vec<ReturnAllocationInput>,
}

#[derive(Debug, Deserialize)]
pub struct RunReturnInput {
    pub returnable_id: i64,
    pub good_pieces: i64,
    pub damaged_pieces: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReconcileRunInput {
    /// Montant physiquement compté dans le sac du livreur.
    pub counted_amount: i64,
    /// Obligatoire dès qu'un écart existe (déclaré ≠ attendu, ou compté ≠ déclaré).
    pub discrepancy_reason: Option<String>,
    pub request_key: Option<String>,
}

// ---------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CollectionLineDto {
    pub method_code: String,
    pub expected: i64,
    pub declared: i64,
    pub declared_gap: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReconciliationDto {
    pub run_id: i64,
    pub reference: String,
    pub status: String,
    pub expected_amount: i64,
    pub declared_amount: i64,
    pub counted_amount: i64,
    /// déclaré − attendu : erreur ou omission du livreur.
    pub declared_gap: i64,
    /// compté − déclaré : manquant ou trop-perçu constaté au comptage.
    pub cash_gap: i64,
    pub discrepancy_reason: Option<String>,
    pub by_method: Vec<CollectionLineDto>,
    /// Vides attendus (somme des arrêts livrés) et effectivement récupérés.
    pub expected_empty_pieces: i64,
    pub returned_good_pieces: i64,
    pub returned_damaged_pieces: i64,
    pub collections_written: i64,
}

// ---------------------------------------------------------------------------
// ① Déclarations du livreur
// ---------------------------------------------------------------------------

/// Enregistre ce que le livreur déclare avoir encaissé à un arrêt.
///
/// Aucun mouvement de caisse n'est écrit. Rejouer la même déclaration met à
/// jour le montant au lieu d'en créer une seconde : `UNIQUE (stop_id,
/// method_code)` porte cette garantie.
pub async fn register_collection(
    db: &DepotDb,
    run_id: i64,
    input: DeclareCollectionInput,
) -> CoreResult<()> {
    require_current_actor_permission(Permission::DeliveryRunsExecute)?;
    if input.amount <= 0 {
        return Err(CoreError::Validation(
            "Le montant déclaré doit être supérieur à zéro.".to_string(),
        ));
    }
    let (_guard, mut tx) = db.begin_write().await?;

    let status = run_status_tx(&mut tx, run_id).await?;
    if !matches!(status.as_str(), "in_progress" | "returned") {
        return Err(CoreError::Validation(format!(
            "On ne déclare des encaissements que sur une tournée en cours ou \
             revenue (statut actuel : {status})."
        )));
    }

    ensure_stop_in_run_tx(&mut tx, run_id, input.stop_id).await?;

    let method_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payment_methods WHERE code = ? AND active = 1")
            .bind(&input.method_code)
            .fetch_one(&mut *tx)
            .await?;
    if method_exists == 0 {
        return Err(CoreError::Validation(format!(
            "Moyen de paiement inconnu ou inactif : {}.",
            input.method_code
        )));
    }

    // Un arrêt en échec n'encaisse rien : accepter une déclaration dessus
    // rendrait l'écart inexploitable.
    let stop_status: String =
        sqlx::query_scalar("SELECT status FROM delivery_run_stops WHERE id = ?")
            .bind(input.stop_id)
            .fetch_one(&mut *tx)
            .await?;
    if matches!(stop_status.as_str(), "failed" | "skipped") {
        return Err(CoreError::Validation(
            "Cet arrêt n'a pas été livré : aucun encaissement ne peut y être déclaré.".to_string(),
        ));
    }

    sqlx::query(
        "INSERT INTO delivery_run_collections (stop_id, method_code, amount)
         VALUES (?, ?, ?)
         ON CONFLICT(stop_id, method_code) DO UPDATE SET amount = excluded.amount",
    )
    .bind(input.stop_id)
    .bind(&input.method_code)
    .bind(input.amount)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// ② Constats du gérant au retour
// ---------------------------------------------------------------------------

/// Constate ce qui s'est réellement passé à un arrêt.
///
/// Refusé une fois la tournée réconciliée : `reconciled` est terminal.
pub async fn record_stop_outcome(
    db: &DepotDb,
    run_id: i64,
    input: RecordStopOutcomeInput,
) -> CoreResult<()> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;
    if !matches!(input.status.as_str(), "delivered" | "failed" | "skipped") {
        return Err(CoreError::Validation(
            "Statut d'arrêt invalide : attendu delivered, failed ou skipped.".to_string(),
        ));
    }
    if matches!(input.status.as_str(), "failed" | "skipped") {
        let reason = input.failure_reason.as_deref().unwrap_or("").trim();
        if reason.is_empty() {
            return Err(CoreError::Validation(
                "Un arrêt non livré doit porter un motif : sans lui, l'écart du soir \
                 est inexplicable."
                    .to_string(),
            ));
        }
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let status = run_status_tx(&mut tx, run_id).await?;
    if status == "reconciled" {
        return Err(CoreError::Validation(
            "Cette tournée est réconciliée : ses constats ne changent plus.".to_string(),
        ));
    }
    if matches!(status.as_str(), "draft" | "cancelled") {
        return Err(CoreError::Validation(format!(
            "Impossible de constater un arrêt sur une tournée au statut {status}."
        )));
    }
    ensure_stop_in_run_tx(&mut tx, run_id, input.stop_id).await?;

    sqlx::query("UPDATE delivery_run_stops SET status = ?, failure_reason = ? WHERE id = ?")
        .bind(&input.status)
        .bind(&input.failure_reason)
        .bind(input.stop_id)
        .execute(&mut *tx)
        .await?;

    // Un arrêt déclaré non livré ne peut plus porter d'encaissement.
    if matches!(input.status.as_str(), "failed" | "skipped") {
        sqlx::query("DELETE FROM delivery_run_collections WHERE stop_id = ?")
            .bind(input.stop_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Enregistre les vides rapportés et leur répartition par client.
///
/// Ce constat, à lui seul, ne solde aucune consigne : il dit seulement *combien*
/// de vides sont revenus et *chez qui* ils ont été repris. C'est la
/// réconciliation qui les impute, une fois pour toutes.
pub async fn record_run_return(
    db: &DepotDb,
    run_id: i64,
    input: RecordRunReturnInput,
) -> CoreResult<()> {
    require_current_actor_permission(Permission::DeliveryRunsManage)?;

    if input.returns.is_empty() && !input.allocations.is_empty() {
        return Err(CoreError::Validation(
            "Une répartition de vides suppose au moins un consignable rapporté.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let status = run_status_tx(&mut tx, run_id).await?;
    if status == "reconciled" {
        return Err(CoreError::Validation(
            "Cette tournée est réconciliée : son retour ne change plus.".to_string(),
        ));
    }
    if matches!(status.as_str(), "draft" | "loaded" | "cancelled") {
        return Err(CoreError::Validation(format!(
            "Un retour de vides ne se saisit qu'après le départ (statut actuel : {status})."
        )));
    }

    // 1. Vides rapportés, par consignable.
    for line in &input.returns {
        if line.good_pieces < 0 || line.damaged_pieces < 0 {
            return Err(CoreError::Validation(
                "Les quantités rapportées ne peuvent pas être négatives.".to_string(),
            ));
        }
        let known: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM returnable_packaging_types WHERE id = ?")
                .bind(line.returnable_id)
                .fetch_one(&mut *tx)
                .await?;
        if known == 0 {
            return Err(CoreError::Validation(format!(
                "Consignable inconnu : {}.",
                line.returnable_id
            )));
        }
        sqlx::query(
            "INSERT INTO delivery_run_returns
                (run_id, returnable_id, good_pieces, damaged_pieces)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(run_id, returnable_id) DO UPDATE SET
                good_pieces = excluded.good_pieces,
                damaged_pieces = excluded.damaged_pieces",
        )
        .bind(run_id)
        .bind(line.returnable_id)
        .bind(line.good_pieces)
        .bind(line.damaged_pieces)
        .execute(&mut *tx)
        .await?;
    }

    // 2. Répartition par client. Elle est remplacée en bloc : c'est un constat,
    //    pas un historique à empiler.
    sqlx::query("DELETE FROM delivery_run_return_allocations WHERE run_id = ?")
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

    for alloc in &input.allocations {
        if alloc.good_pieces < 0 || alloc.damaged_pieces < 0 {
            return Err(CoreError::Validation(
                "Les quantités réparties ne peuvent pas être négatives.".to_string(),
            ));
        }
        let in_run: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM delivery_run_stops WHERE run_id = ? AND client_id = ?",
        )
        .bind(run_id)
        .bind(alloc.client_id)
        .fetch_one(&mut *tx)
        .await?;
        if in_run == 0 {
            return Err(CoreError::Validation(
                "Le client de la répartition ne figure pas dans cette tournée.".to_string(),
            ));
        }
        sqlx::query(
            "INSERT INTO delivery_run_return_allocations
                (run_id, client_id, returnable_id, good_pieces, damaged_pieces)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(alloc.client_id)
        .bind(alloc.returnable_id)
        .bind(alloc.good_pieces)
        .bind(alloc.damaged_pieces)
        .execute(&mut *tx)
        .await?;
    }

    // 3. Contrôle de cohérence : on ne peut pas répartir plus qu'on a rapporté,
    //    sinon le stock de vides augmenterait sans contrepartie physique.
    let reported: Vec<(i64, i64, i64)> = sqlx::query_as(
        "SELECT returnable_id, good_pieces, damaged_pieces
         FROM delivery_run_returns WHERE run_id = ?",
    )
    .bind(run_id)
    .fetch_all(&mut *tx)
    .await?;
    for (returnable_id, good, damaged) in reported {
        let (alloc_good, alloc_damaged): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(SUM(good_pieces), 0), COALESCE(SUM(damaged_pieces), 0)
             FROM delivery_run_return_allocations
             WHERE run_id = ? AND returnable_id = ?",
        )
        .bind(run_id)
        .bind(returnable_id)
        .fetch_one(&mut *tx)
        .await?;
        if alloc_good > good || alloc_damaged > damaged {
            return Err(CoreError::Validation(format!(
                "Répartition incohérente pour le consignable {returnable_id} : \
                 {alloc_good} bons et {alloc_damaged} abîmés répartis, \
                 mais {good} et {damaged} rapportés. On ne répartit pas ce qui n'est pas revenu."
            )));
        }
    }

    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// ③ Réconciliation
// ---------------------------------------------------------------------------

/// Clôture la tournée : écrit les mouvements de caisse, impute les vides, calcule
/// les écarts.
///
/// Prérequis : tournée `returned` (donc avec ses constats saisis) et session de
/// caisse ouverte. Tout est fait dans une seule transaction : soit la tournée
/// est entièrement réconciliée, soit rien n'a bougé.
pub async fn reconcile_run(
    db: &DepotDb,
    run_id: i64,
    input: ReconcileRunInput,
) -> CoreResult<ReconciliationDto> {
    require_current_actor_permission(Permission::DeliveryRunsReconcile)?;
    if input.counted_amount < 0 {
        return Err(CoreError::Validation(
            "Le montant compté ne peut pas être négatif.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;

    let (reference, status): (String, String) =
        sqlx::query_as("SELECT reference, status FROM delivery_runs WHERE id = ?")
            .bind(run_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| CoreError::NotFound("Tournée introuvable.".to_string()))?;

    if status == "reconciled" {
        // Idempotent : rejouer la réconciliation renvoie le constat existant
        // sans réécrire un seul mouvement de caisse.
        let dto = reconciliation_dto_tx(&mut tx, run_id).await?;
        tx.commit().await?;
        return Ok(dto);
    }
    if status != "returned" {
        return Err(CoreError::Validation(format!(
            "Une tournée doit être revenue avant d'être réconciliée \
             (statut actuel : {status})."
        )));
    }

    // Règle unique du dépôt : tout franc qui entre passe par une session
    // ouverte. Sans elle, la caisse théorique du soir serait fausse.
    let (session_id, _sref, _opening) = require_open_session_tx(&mut tx).await?;

    // --- Attendus ------------------------------------------------------------
    let (expected_total, expected_empty): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(expected_amount), 0), COALESCE(SUM(expected_empty_pieces), 0)
         FROM delivery_run_stops
         WHERE run_id = ? AND status = 'delivered'",
    )
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;

    // --- Déclaré -------------------------------------------------------------
    let declared_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(c.amount), 0)
         FROM delivery_run_collections c
         JOIN delivery_run_stops s ON s.id = c.stop_id
         WHERE s.run_id = ? AND s.status = 'delivered'",
    )
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;

    let declared_gap = declared_total - expected_total;
    let cash_gap = input.counted_amount - declared_total;

    let reason = input
        .discrepancy_reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty());
    if (declared_gap != 0 || cash_gap != 0) && reason.is_none() {
        return Err(CoreError::Validation(format!(
            "Écart détecté (déclaré − attendu = {declared_gap} FCFA, \
             compté − déclaré = {cash_gap} FCFA) : un motif est obligatoire. \
             Un écart sans explication est un écart qu'on ne corrigera jamais."
        )));
    }

    // La caisse doit encaisser ce qui est RÉELLEMENT rentré, donc le compté.
    // Si le livreur a déclaré 10 000 et rendu 9 500, entrer 10 000 rendrait la
    // caisse théorique fausse de 500 à chaque tournée.
    if input.counted_amount > 0 {
        let request_key = input
            .request_key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("dr-reconcile:{run_id}"));

        let already: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements WHERE request_key = ?")
                .bind(&request_key)
                .fetch_one(&mut *tx)
                .await?;
        if already > 0 {
            return Err(CoreError::DuplicateOperation(
                "Cette clé d'idempotence a déjà servi pour un mouvement de caisse.".to_string(),
            ));
        }

        let driver_user_id: i64 =
            sqlx::query_scalar("SELECT driver_user_id FROM delivery_runs WHERE id = ?")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await?;

        sqlx::query(
            "INSERT INTO cash_movements
                (session_id, request_key, kind, method_code, direction, amount,
                 description, reference_document, delivery_run_id, collected_by_user_id)
             VALUES (?, ?, 'receivable', 'cash', 'in', ?, ?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(&request_key)
        .bind(input.counted_amount)
        .bind(format!(
            "Réconciliation tournée {reference} : {} FCFA comptés en espèces",
            input.counted_amount
        ))
        .bind(&reference)
        .bind(run_id)
        .bind(driver_user_id)
        .execute(&mut *tx)
        .await?;
    }

    // --- Vides : reprise en stock et solde des consignes ----------------------
    let returned: Vec<(i64, i64, i64)> = sqlx::query_as(
        "SELECT returnable_id, good_pieces, damaged_pieces
         FROM delivery_run_returns WHERE run_id = ?",
    )
    .bind(run_id)
    .fetch_all(&mut *tx)
    .await?;

    for (returnable_id, good, damaged) in returned {
        // Les abîmés ne rentrent pas dans le stock réutilisable : ils sont
        // constatés en perte, ce qui est la seule façon de ne pas laisser
        // croire que le parc est intact.
        if good > 0 {
            add_returnable_stock_tx(
                &mut tx,
                run_id,
                returnable_id,
                good,
                "entry",
                &format!("Retour tournée {reference} : {good} pièces en bon état"),
            )
            .await?;
        }
        if damaged > 0 {
            add_returnable_stock_tx(
                &mut tx,
                run_id,
                returnable_id,
                damaged,
                "breakage",
                &format!("Retour tournée {reference} : {damaged} pièces abîmées"),
            )
            .await?;
        }

        // Solde des consignes, client par client, selon ce que le gérant a
        // observé chez chacun — jamais en FIFO global.
        let allocs: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT client_id, good_pieces + damaged_pieces
             FROM delivery_run_return_allocations
             WHERE run_id = ? AND returnable_id = ?",
        )
        .bind(run_id)
        .bind(returnable_id)
        .fetch_all(&mut *tx)
        .await?;
        for (client_id, pieces) in allocs {
            if pieces <= 0 {
                continue;
            }
            settle_deposit_issues_tx(&mut tx, client_id, returnable_id, None, pieces).await?;
        }
    }

    // --- Clôture -------------------------------------------------------------
    sqlx::query(
        "UPDATE delivery_runs
         SET status = 'reconciled', counted_amount = ?, discrepancy_reason = ?,
             closed_key = COALESCE(closed_key, ?), closed_at = datetime('now')
         WHERE id = ?",
    )
    .bind(input.counted_amount)
    .bind(reason)
    .bind(format!("dr-reconcile:{run_id}"))
    .bind(run_id)
    .execute(&mut *tx)
    .await?;

    let mut dto = reconciliation_dto_tx(&mut tx, run_id).await?;
    dto.expected_empty_pieces = expected_empty;
    tx.commit().await?;
    Ok(dto)
}

/// État de la réconciliation d'une tournée, sans rien écrire.
pub async fn get_reconciliation(db: &DepotDb, run_id: i64) -> CoreResult<ReconciliationDto> {
    require_current_actor_permission(Permission::DeliveryRunsRead)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let dto = reconciliation_dto_tx(&mut tx, run_id).await?;
    tx.commit().await?;
    Ok(dto)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn run_status_tx(tx: &mut Transaction<'_, Sqlite>, run_id: i64) -> CoreResult<String> {
    sqlx::query_scalar("SELECT status FROM delivery_runs WHERE id = ?")
        .bind(run_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| CoreError::NotFound("Tournée introuvable.".to_string()))
}

async fn ensure_stop_in_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: i64,
    stop_id: i64,
) -> CoreResult<()> {
    let belongs: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM delivery_run_stops WHERE id = ? AND run_id = ?")
            .bind(stop_id)
            .bind(run_id)
            .fetch_one(&mut **tx)
            .await?;
    if belongs == 0 {
        return Err(CoreError::Validation(
            "Cet arrêt n'appartient pas à cette tournée.".to_string(),
        ));
    }
    Ok(())
}

/// Ajoute des pièces au stock de vides et journalise le mouvement.
async fn add_returnable_stock_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: i64,
    returnable_id: i64,
    pieces: i64,
    movement_type: &str,
    reason: &str,
) -> CoreResult<()> {
    let before: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances
                          WHERE packaging_id = ?), 0)",
    )
    .bind(returnable_id)
    .fetch_one(&mut **tx)
    .await?;
    let after = before.saturating_add(pieces);

    sqlx::query(
        "INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, ?)
         ON CONFLICT(packaging_id) DO UPDATE SET quantity = excluded.quantity",
    )
    .bind(returnable_id)
    .bind(after)
    .execute(&mut **tx)
    .await?;

    let unit_value: i64 =
        sqlx::query_scalar("SELECT deposit_value FROM returnable_packaging_types WHERE id = ?")
            .bind(returnable_id)
            .fetch_one(&mut **tx)
            .await?;

    let movement_key = if movement_type == "breakage" {
        format!("dr-brk:{run_id}:{returnable_id}")
    } else {
        format!("dr-ret:{run_id}:{returnable_id}")
    };

    sqlx::query(
        "INSERT INTO returnable_stock_movements
            (request_key, packaging_id, movement_type, quantity, stock_before, stock_after,
             reason, reference_document, unit_deposit_value, total_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(request_key) DO NOTHING",
    )
    .bind(&movement_key)
    .bind(returnable_id)
    .bind(movement_type)
    .bind(pieces)
    .bind(before)
    .bind(after)
    .bind(reason)
    .bind(format!("TRN-{run_id}"))
    .bind(unit_value)
    .bind(pieces * unit_value)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn reconciliation_dto_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: i64,
) -> CoreResult<ReconciliationDto> {
    let row = sqlx::query(
        "SELECT id, reference, status, counted_amount, discrepancy_reason
         FROM delivery_runs WHERE id = ?",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::NotFound("Tournée introuvable.".to_string()))?;

    let reference: String = row.try_get("reference")?;
    let status: String = row.try_get("status")?;
    let counted_raw: Option<i64> = row.try_get("counted_amount")?;
    let discrepancy_reason: Option<String> = row.try_get("discrepancy_reason")?;

    let (expected_amount, expected_empty_pieces): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(expected_amount), 0), COALESCE(SUM(expected_empty_pieces), 0)
         FROM delivery_run_stops
         WHERE run_id = ? AND status = 'delivered'",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;

    // Détail par moyen : l'attendu théorique par moyen existe seulement si la
    // tournée le connaît. Les commandes ne disent pas « payable en Wave », donc
    // l'attendu est porté en entier par le premier moyen déclaré — c'est une
    // répartition indicative, et le contrôle qui compte est le total.
    let rows = sqlx::query(
        "SELECT c.method_code, COALESCE(SUM(c.amount), 0) AS declared
         FROM delivery_run_collections c
         JOIN delivery_run_stops s ON s.id = c.stop_id
         WHERE s.run_id = ? AND s.status = 'delivered'
         GROUP BY c.method_code
         ORDER BY c.method_code",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await?;

    let declared_amount: i64 = rows.iter().map(|r| r.get::<i64, _>("declared")).sum();

    let mut by_method = Vec::with_capacity(rows.len());
    for (idx, r) in rows.iter().enumerate() {
        let method_code: String = r.try_get("method_code")?;
        let declared: i64 = r.try_get("declared")?;
        let expected = if idx == 0 { expected_amount } else { 0 };
        by_method.push(CollectionLineDto {
            method_code,
            expected,
            declared,
            declared_gap: declared - expected,
        });
    }

    let counted_amount = counted_raw.unwrap_or(0);
    let cash_gap = if counted_raw.is_some() {
        counted_amount - declared_amount
    } else {
        0
    };

    let (returned_good, returned_damaged): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(good_pieces), 0), COALESCE(SUM(damaged_pieces), 0)
         FROM delivery_run_returns WHERE run_id = ?",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;

    let collections_written: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements WHERE delivery_run_id = ?")
            .bind(run_id)
            .fetch_one(&mut **tx)
            .await?;

    Ok(ReconciliationDto {
        run_id,
        reference,
        status,
        expected_amount,
        declared_amount,
        counted_amount: counted_raw.unwrap_or(0),
        declared_gap: declared_amount - expected_amount,
        cash_gap,
        discrepancy_reason,
        by_method,
        expected_empty_pieces,
        returned_good_pieces: returned_good,
        returned_damaged_pieces: returned_damaged,
        collections_written,
    })
}
