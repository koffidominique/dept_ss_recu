// ============================================================================
// Liste et création des clients
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::domain::money::Money;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{audit_log_tx, ClientSummaryDto, CreateClientInput};

pub async fn list_clients(db: &DepotDb, search: Option<&str>) -> CoreResult<Vec<ClientSummaryDto>> {
    require_current_actor_permission(Permission::SalesRead)?;
    let q = search.map(str::trim).filter(|s| !s.is_empty());
    let pattern = q.map(|s| format!("%{s}%"));
    let rows = match pattern {
        Some(pat) => {
            sqlx::query_as::<_, ClientSummaryDto>(
                "SELECT c.id, c.code, c.name, c.client_type, c.establishment_name, c.category,
                        c.phone, c.address, c.city, c.commune, c.quartier, c.landmark,
                        c.email, c.contact_person, c.is_active,
                        ccs.policy AS credit_policy, ccs.credit_limit, ccs.payment_terms_days,
                        COALESCE((SELECT SUM(remaining_amount) FROM customer_receivables r WHERE r.client_id = c.id AND r.status IN ('open', 'partial')), 0)
                        + MAX(0, COALESCE((SELECT SUM(CASE WHEN l.direction = 'debit' THEN l.amount ELSE -l.amount END) FROM customer_packaging_financial_ledger l WHERE l.client_id = c.id), 0)) AS unpaid_balance,
                        COALESCE((SELECT SUM(balance_pieces) FROM customer_packaging_accounts cpa WHERE cpa.client_id = c.id), 0) AS returnable_pieces_due
                 FROM clients c
                 LEFT JOIN client_credit_settings ccs ON ccs.client_id = c.id
                 WHERE c.name LIKE ? OR c.code LIKE ? OR COALESCE(c.phone, '') LIKE ? OR COALESCE(c.establishment_name, '') LIKE ?
                 ORDER BY c.is_active DESC, c.name ASC",
            )
            .bind(&pat)
            .bind(&pat)
            .bind(&pat)
            .bind(&pat)
            .fetch_all(&db.pool)
            .await?
        }
        None => {
            sqlx::query_as::<_, ClientSummaryDto>(
                "SELECT c.id, c.code, c.name, c.client_type, c.establishment_name, c.category,
                        c.phone, c.address, c.city, c.commune, c.quartier, c.landmark,
                        c.email, c.contact_person, c.is_active,
                        ccs.policy AS credit_policy, ccs.credit_limit, ccs.payment_terms_days,
                        COALESCE((SELECT SUM(remaining_amount) FROM customer_receivables r WHERE r.client_id = c.id AND r.status IN ('open', 'partial')), 0)
                        + MAX(0, COALESCE((SELECT SUM(CASE WHEN l.direction = 'debit' THEN l.amount ELSE -l.amount END) FROM customer_packaging_financial_ledger l WHERE l.client_id = c.id), 0)) AS unpaid_balance,
                        COALESCE((SELECT SUM(balance_pieces) FROM customer_packaging_accounts cpa WHERE cpa.client_id = c.id), 0) AS returnable_pieces_due
                 FROM clients c
                 LEFT JOIN client_credit_settings ccs ON ccs.client_id = c.id
                 ORDER BY c.is_active DESC, c.name ASC",
            )
            .fetch_all(&db.pool)
            .await?
        }
    };
    Ok(rows)
}

pub async fn create_client(db: &DepotDb, input: CreateClientInput) -> CoreResult<ClientSummaryDto> {
    require_current_actor_permission(Permission::SalesWrite)?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(CoreError::Validation(
            "Le nom du client est obligatoire.".to_string(),
        ));
    }
    if !matches!(input.client_type.as_str(), "particulier" | "professionnel") {
        return Err(CoreError::Validation(
            "Type de client invalide.".to_string(),
        ));
    }
    if !matches!(
        input.credit_policy.as_str(),
        "forbidden" | "limited" | "unlimited"
    ) {
        return Err(CoreError::Validation(
            "Politique de crédit explicite requise.".to_string(),
        ));
    }
    let limit = if input.credit_policy == "limited" {
        let raw = input.credit_limit.ok_or_else(|| {
            CoreError::Validation("Plafond de crédit requis pour la politique limitée.".to_string())
        })?;
        Some(Money::from_non_negative(raw, "Plafond de crédit")?.value())
    } else {
        None
    };
    let terms = input.payment_terms_days.unwrap_or(0);
    if terms < 0 {
        return Err(CoreError::Validation(
            "Délai de paiement invalide.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let code = DepotDb::next_sequence(&mut tx, "CLI").await?;

    let opt_trim = |v: Option<&str>| {
        v.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let client_id: i64 = sqlx::query(
        "INSERT INTO clients (code, name, client_type, establishment_name, category, phone, address, city, commune, quartier, landmark, email, contact_person)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&code)
    .bind(&name)
    .bind(&input.client_type)
    .bind(opt_trim(input.establishment_name.as_deref()))
    .bind(opt_trim(input.category.as_deref()))
    .bind(opt_trim(input.phone.as_deref()))
    .bind(opt_trim(input.address.as_deref()))
    .bind(opt_trim(input.city.as_deref()))
    .bind(opt_trim(input.commune.as_deref()))
    .bind(opt_trim(input.quartier.as_deref()))
    .bind(opt_trim(input.landmark.as_deref()))
    .bind(opt_trim(input.email.as_deref()))
    .bind(opt_trim(input.contact_person.as_deref()))
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    sqlx::query(
        "INSERT INTO client_credit_settings (client_id, policy, credit_limit, payment_terms_days)
         VALUES (?, ?, ?, ?)",
    )
    .bind(client_id)
    .bind(&input.credit_policy)
    .bind(limit)
    .bind(terms)
    .execute(&mut *tx)
    .await?;

    audit_log_tx(
        &mut tx,
        "CREATE_CLIENT",
        "clients",
        Some(client_id.to_string()),
        &format!("{code} — {name} ({})", input.credit_policy),
    )
    .await?;
    tx.commit().await?;

    let clients = list_clients(db, Some(&code)).await?;
    clients
        .into_iter()
        .find(|c| c.id == client_id)
        .ok_or_else(|| CoreError::Internal("Client créé introuvable.".to_string()))
}
