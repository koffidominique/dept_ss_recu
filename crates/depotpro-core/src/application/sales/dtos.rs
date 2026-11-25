// ============================================================================
// DTOs et structures d'entrée pour clients et ventes
// ============================================================================

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::application::products::{deserialize_nullable_opt, deserialize_qty_str};

#[derive(Debug, Serialize, FromRow)]
pub struct ClientSummaryDto {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub client_type: String,
    pub establishment_name: Option<String>,
    pub category: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub commune: Option<String>,
    pub quartier: Option<String>,
    pub landmark: Option<String>,
    pub email: Option<String>,
    pub contact_person: Option<String>,
    pub is_active: i64,
    pub credit_policy: Option<String>,
    pub credit_limit: Option<i64>,
    pub payment_terms_days: Option<i64>,
    pub unpaid_balance: i64,
    pub returnable_pieces_due: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct CreateClientInput {
    pub name: String,
    pub client_type: String,
    #[serde(default)]
    pub establishment_name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    #[serde(default)]
    pub commune: Option<String>,
    #[serde(default)]
    pub quartier: Option<String>,
    #[serde(default)]
    pub landmark: Option<String>,
    pub email: Option<String>,
    pub contact_person: Option<String>,
    pub credit_policy: String,
    pub credit_limit: Option<i64>,
    pub payment_terms_days: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCreditPolicyInput {
    pub credit_policy: String,
    pub credit_limit: Option<i64>,
    pub payment_terms_days: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ClientCreditSettingsDto {
    pub client_id: i64,
    pub policy: String,
    pub credit_limit: Option<i64>,
    pub payment_terms_days: i64,
    pub updated_at: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct UpdateClientInput {
    pub name: Option<String>,
    pub client_type: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub establishment_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub category: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub phone: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub address: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub city: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub commune: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub quartier: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub landmark: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub email: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_opt")]
    pub contact_person: Option<Option<String>>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSaleLineInput {
    pub product_id: i64,
    pub packaging_id: i64,
    #[serde(deserialize_with = "deserialize_qty_str")]
    pub quantity: String,
    pub discount_amount: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSaleLineV4Input {
    pub product_id: i64,
    pub packaging_id: i64,
    pub sales_unit_id: Option<i64>,
    #[serde(deserialize_with = "deserialize_qty_str")]
    pub quantity: String,
    pub discount_amount: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PaymentPartInput {
    pub method_code: String,
    pub amount: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct ReceivedReturnableInput {
    pub returnable_id: i64,
    pub pieces: i64,
    /// Index de la ligne de vente d'origine, quand la restitution est saisie
    /// sur une ligne precise.
    ///
    /// `None` = retour global au type d'emballage (comportement historique,
    /// conserve pour le desktop et les appels existants). C'est ce champ qui
    /// permet a la fiche de suivi client de dire QUELLE ligne doit encore un
    /// casier, au lieu d'un total agrege.
    #[serde(default)]
    pub line_index: Option<usize>,
}

#[derive(Debug, Default, Deserialize)]
pub struct CreateSaleInput {
    pub request_key: String,
    pub client_id: Option<i64>,
    pub sale_type: String,
    pub price_tier: String,
    pub discount_amount: Option<i64>,
    pub notes: Option<String>,
    pub lines: Vec<CreateSaleLineInput>,
    pub payments: Vec<PaymentPartInput>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub external_reference: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct CreateSaleV4Input {
    pub request_key: String,
    pub client_id: Option<i64>,
    pub sale_type: String,
    pub price_tier: String,
    pub discount_amount: Option<i64>,
    pub notes: Option<String>,
    pub lines: Vec<CreateSaleLineV4Input>,
    pub payments: Vec<PaymentPartInput>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub external_reference: Option<String>,
    #[serde(default)]
    pub received_returnables: Option<Vec<ReceivedReturnableInput>>,
}

#[derive(Debug, Deserialize)]
pub struct CancelSaleInput {
    pub reason: String,
    pub refund_method_code: Option<String>,
    pub request_key: String,
}

#[derive(Debug, Deserialize)]
pub struct SaleReturnLineInput {
    pub sale_line_id: i64,
    #[serde(deserialize_with = "deserialize_qty_str")]
    pub base_quantity: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSaleReturnInput {
    pub request_key: String,
    pub reason: String,
    pub restock_approved: bool,
    pub refund_method_code: String,
    pub lines: Vec<SaleReturnLineInput>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleLineDto {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub packaging_id: i64,
    pub variant_id: Option<i64>,
    pub sales_unit_id: Option<i64>,
    pub sales_unit_label: Option<String>,
    pub product_name: String,
    pub packaging_name: String,
    pub base_unit: String,
    pub coefficient_milli: i64,
    pub quantity_milli: i64,
    pub base_quantity_milli: i64,
    pub unit_price: i64,
    pub discount_amount: i64,
    pub line_total: i64,
    pub returned_base_milli: i64,
    pub product_snapshot_json: String,
    pub packaging_snapshot_json: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleSummaryDto {
    pub id: i64,
    pub reference: String,
    pub client_id: Option<i64>,
    pub client_name: String,
    pub sale_type: String,
    pub price_tier: String,
    pub subtotal_merchandise: i64,
    pub discount_amount: i64,
    pub total_merchandise: i64,
    pub total_deposit: i64,
    pub total_amount: i64,
    pub paid_amount: i64,
    pub remaining_amount: i64,
    pub payment_labels: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SalePaymentDto {
    pub id: i64,
    pub reference: String,
    pub method_code: String,
    pub method_label: String,
    pub part_amount: i64,
    pub external_reference: Option<String>,
    pub recorded_by_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleDepositDto {
    pub id: i64,
    pub sale_line_id: Option<i64>,
    pub returnable_id: i64,
    pub kind: String,
    pub packaging_name: String,
    pub packaging_code: String,
    pub pieces: i64,
    pub returned_pieces: i64,
    pub unit_value: i64,
    pub amount: i64,
    pub expected_products: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleReceivedReturnableDto {
    pub id: i64,
    pub returnable_id: i64,
    pub kind: String,
    pub packaging_name: String,
    pub packaging_code: String,
    pub pieces: i64,
    pub unit_value: i64,
    pub amount: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleCancellationDto {
    pub id: i64,
    pub reason: String,
    pub refund_method_code: Option<String>,
    pub refunded_amount: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SaleReturnDto {
    pub id: i64,
    pub reference: String,
    pub credit_note_ref: String,
    pub total_amount: i64,
    pub credit_reduction: i64,
    pub refund_amount: i64,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedSalesDto {
    pub items: Vec<SaleSummaryDto>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize)]
pub struct SaleDetailDto {
    #[serde(flatten)]
    pub sale: SaleSummaryDto,
    pub client_code: Option<String>,
    pub client_phone: Option<String>,
    pub receivable_id: Option<i64>,
    pub due_date: Option<String>,
    pub lines: Vec<SaleLineDto>,
    pub payments: Vec<SalePaymentDto>,
    pub deposits: Vec<SaleDepositDto>,
    pub received_returnables: Vec<SaleReceivedReturnableDto>,
    pub total_returned_packaging_amount: i64,
    pub cancellation: Option<SaleCancellationDto>,
    pub returns: Vec<SaleReturnDto>,
}
