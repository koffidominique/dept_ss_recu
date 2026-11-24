// ============================================================================
// Caisse, créances clients et dépenses : DTOs & sous-modules
// ============================================================================

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::application::sales::PaymentPartInput;

mod expenses;
pub mod payment_receipts;
mod receivables;
mod sessions;

pub use expenses::{
    create_expense, list_expenses, ExpenseCategoryDto, ExpenseItemDto, ExpensesOverviewDto,
};
pub use payment_receipts::{get_or_issue_payment_receipt, PaymentReceiptSnapshotDto};
pub use receivables::{list_receivables, pay_receivable};
pub use sessions::{close_cash_session, get_cash_status, open_cash_session};

#[derive(Debug, Serialize, FromRow)]
pub struct CashSessionDto {
    pub id: i64,
    pub reference: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub status: String,
    pub opening_cash: i64,
    pub theoretical_cash: Option<i64>,
    pub physical_cash: Option<i64>,
    pub difference: Option<i64>,
    pub closing_notes: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct MethodSummaryDto {
    pub method_code: String,
    pub label: String,
    pub is_cash: i64,
    pub total_in: i64,
    pub total_out: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CashMovementDto {
    pub id: i64,
    pub kind: String,
    pub method_code: String,
    pub method_label: String,
    pub is_cash: i64,
    pub direction: String,
    pub amount: i64,
    pub description: String,
    pub reference_document: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashSummaryDto {
    pub theoretical_cash: i64,
    pub by_method: Vec<MethodSummaryDto>,
    pub movements: Vec<CashMovementDto>,
}

/// Une tournée dont l'argent est encore dans le sac du livreur.
///
/// Cet argent n'est PAS en caisse : il est en transit. L'afficher dans l'état
/// de caisse sans le compter dans le théorique est le seul moyen de répondre à
/// « où est passé l'argent ? » sans rendre le tiroir faux.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RunInTransitDto {
    pub run_id: i64,
    pub reference: String,
    pub run_date: String,
    pub driver_name: String,
    pub status: String,
    /// Somme des encaissements déclarés par le livreur sur les arrêts livrés.
    pub declared_amount: i64,
    /// Somme des attendus des arrêts livrés (figée au chargement).
    pub expected_amount: i64,
    pub declared_stops: i64,
    pub planned_stops: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashStatusDto {
    pub active_session: Option<CashSessionDto>,
    pub summary: Option<CashSummaryDto>,
    pub history: Vec<CashSessionDto>,
    /// Argent en transit, hors caisse. Toujours présent, même sans session
    /// ouverte : le livreur peut être sur la route avant l'ouverture du tiroir.
    pub runs_in_transit: Vec<RunInTransitDto>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ReceivableDto {
    pub id: i64,
    pub sale_id: i64,
    pub sale_reference: String,
    pub sale_date: String,
    pub sale_total: i64,
    pub client_id: i64,
    pub client_name: String,
    pub client_code: String,
    pub client_phone: Option<String>,
    pub initial_amount: i64,
    pub remaining_amount: i64,
    pub due_date: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenCashInput {
    pub opening_cash: i64,
    pub request_key: String,
}

#[derive(Debug, Deserialize)]
pub struct CloseCashInput {
    pub session_id: i64,
    pub physical_cash: i64,
    pub closing_notes: Option<String>,
    pub request_key: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct PayReceivableInput {
    pub request_key: String,
    pub note: Option<String>,
    #[serde(default)]
    pub external_reference: Option<String>,
    pub parts: Vec<PaymentPartInput>,
}

#[derive(Debug, Deserialize)]
pub struct CreateExpenseInput {
    pub request_key: String,
    pub category: String,
    pub amount: i64,
    pub method_code: String,
    pub beneficiary: Option<String>,
    pub notes: Option<String>,
    pub receipt_path: Option<String>,
    pub expense_date: Option<String>,
}
