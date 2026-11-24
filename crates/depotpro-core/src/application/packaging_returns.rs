// ============================================================================
// Répartition d'un retour de vides sur les consignes ouvertes d'un client
// ============================================================================

//! Partagé entre le retour d'emballage d'une commande et le retour d'une
//! tournée. La règle ne doit exister qu'à un seul endroit : deux copies
//! divergent tôt ou tard, et c'est le genre d'écart qui se voit en comptabilité.
//!
//! Ordre de solde, tel qu'il était écrit dans `packaging_and_returns.rs` :
//!   1. la vente de la commande concernée d'abord (si une commande est fournie),
//!   2. puis l'échéance la plus ancienne,
//!   3. puis l'identifiant, pour un ordre stable.
//!
//! Les consignes converties, perdues ou détruites ne sont jamais soldées par un
//! retour physique : ces pièces ne reviendront pas.

use sqlx::{Sqlite, Transaction};

use crate::error::CoreResult;

/// Solde jusqu'à `quantity` pièces sur les consignes ouvertes de `client_id`
/// pour le consignable `returnable_id`.
///
/// Retourne le nombre de pièces effectivement imputées, qui peut être inférieur
/// à `quantity` s'il n'y a pas assez de dette ouverte. Ce n'est PAS une erreur :
/// un casier peut revenir alors que la consigne qui l'a créée est déjà soldée
/// (cas du client qui rend tardivement un casier d'une vieille commande), et
/// l'excédent doit être visible, pas silencieusement absorbé.
pub(crate) async fn settle_deposit_issues_tx(
    tx: &mut Transaction<'_, Sqlite>,
    client_id: i64,
    returnable_id: i64,
    order_id: Option<i64>,
    quantity: i64,
) -> CoreResult<i64> {
    if quantity <= 0 {
        return Ok(0);
    }

    let order_sale_id: Option<i64> = if let Some(oid) = order_id {
        sqlx::query_scalar("SELECT id FROM sales WHERE order_id = ?")
            .bind(oid)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };

    let open_issues: Vec<(i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT id, pieces, returned_pieces, lost_pieces + destroyed_pieces + converted_pieces
         FROM deposit_issues
         WHERE client_id = ? AND returnable_id = ?
           AND status IN ('pending', 'partially_returned')
         ORDER BY CASE WHEN ? IS NOT NULL AND sale_id = ? THEN 0 ELSE 1 END ASC,
                  COALESCE(due_date, '9999-12-31') ASC,
                  id ASC",
    )
    .bind(client_id)
    .bind(returnable_id)
    .bind(order_sale_id)
    .bind(order_sale_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut remaining = quantity;
    for (issue_id, iss_pieces, iss_returned, iss_other_out) in open_issues {
        if remaining <= 0 {
            break;
        }
        let iss_pending = (iss_pieces - iss_returned - iss_other_out).max(0);
        if iss_pending <= 0 {
            continue;
        }
        let applied = remaining.min(iss_pending);
        let next_returned = iss_returned + applied;
        let next_status = if next_returned + iss_other_out >= iss_pieces {
            "settled"
        } else {
            "partially_returned"
        };
        sqlx::query(
            "UPDATE deposit_issues
             SET returned_pieces = ?, status = ?, updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(next_returned)
        .bind(next_status)
        .bind(issue_id)
        .execute(&mut **tx)
        .await?;
        remaining -= applied;
    }

    // `remaining` est ce qui n'a pas pu etre impute : l'impute est le reste.
    Ok(quantity - remaining)
}
