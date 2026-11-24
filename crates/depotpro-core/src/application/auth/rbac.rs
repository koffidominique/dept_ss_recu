// ============================================================================
// Modèle RBAC : rôles, permissions granulaires et identité de session
// ============================================================================

use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Owner,
    Admin,
    Manager,
    Cashier,
    StockManager,
    Accountant,
    Driver,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Manager => "manager",
            Role::Cashier => "cashier",
            Role::StockManager => "stock_manager",
            Role::Accountant => "accountant",
            Role::Driver => "driver",
        }
    }

    pub fn label_fr(self) -> &'static str {
        match self {
            Role::Owner => "Propriétaire",
            Role::Admin => "Administrateur",
            Role::Manager => "Responsable",
            Role::Cashier => "Caissier",
            Role::StockManager => "Gestionnaire de stock",
            Role::Accountant => "Comptable",
            Role::Driver => "Livreur",
        }
    }

    pub fn from_db_str(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "owner" => Ok(Role::Owner),
            "admin" => Ok(Role::Admin),
            "manager" => Ok(Role::Manager),
            "cashier" => Ok(Role::Cashier),
            "stock_manager" => Ok(Role::StockManager),
            "accountant" => Ok(Role::Accountant),
            "driver" => Ok(Role::Driver),
            other => Err(CoreError::Validation(format!("Rôle inconnu : {other}"))),
        }
    }

    pub fn permissions(self) -> &'static [Permission] {
        match self {
            Role::Owner => Permission::ALL,
            Role::Admin => &[
                Permission::CatalogRead,
                Permission::CatalogWrite,
                Permission::SalesRead,
                Permission::SalesWrite,
                Permission::SalesCancelReturn,
                Permission::ReceivablesRead,
                Permission::ReceivablesPay,
                Permission::PurchasesRead,
                Permission::PurchasesWrite,
                Permission::SupplierDebtsPay,
                Permission::StockRead,
                Permission::StockAdjust,
                Permission::InventoryValidate,
                Permission::ConsignmentsRead,
                Permission::ConsignmentsWrite,
                Permission::CashRead,
                Permission::CashOperate,
                Permission::ExpensesWrite,
                Permission::ReportsRead,
                Permission::SettingsRead,
                Permission::SettingsWrite,
                Permission::BackupsRead,
                Permission::BackupsCreate,
                Permission::BackupsRestore,
                Permission::SecurityManageUsers,
                Permission::DeliveryRunsRead,
                Permission::DeliveryRunsManage,
                Permission::DeliveryRunsReconcile,
            ],
            Role::Manager => &[
                Permission::CatalogRead,
                Permission::CatalogWrite,
                Permission::SalesRead,
                Permission::SalesWrite,
                Permission::SalesCancelReturn,
                Permission::ReceivablesRead,
                Permission::ReceivablesPay,
                Permission::PurchasesRead,
                Permission::PurchasesWrite,
                Permission::SupplierDebtsPay,
                Permission::StockRead,
                Permission::StockAdjust,
                Permission::InventoryValidate,
                Permission::ConsignmentsRead,
                Permission::ConsignmentsWrite,
                Permission::CashRead,
                Permission::CashOperate,
                Permission::ExpensesWrite,
                Permission::ReportsRead,
                Permission::SettingsRead,
                Permission::BackupsRead,
                Permission::BackupsCreate,
                Permission::DeliveryRunsRead,
                Permission::DeliveryRunsManage,
                Permission::DeliveryRunsReconcile,
            ],
            Role::Cashier => &[
                Permission::CatalogRead,
                Permission::SalesRead,
                Permission::SalesWrite,
                Permission::SalesCancelReturn,
                Permission::ReceivablesRead,
                Permission::ReceivablesPay,
                Permission::ConsignmentsRead,
                Permission::ConsignmentsWrite,
                Permission::CashRead,
                Permission::CashOperate,
                Permission::ExpensesWrite,
                Permission::SettingsRead,
                Permission::DeliveryRunsRead,
                Permission::DeliveryRunsReconcile,
            ],
            Role::StockManager => &[
                Permission::CatalogRead,
                Permission::CatalogWrite,
                Permission::PurchasesRead,
                Permission::PurchasesWrite,
                Permission::StockRead,
                Permission::StockAdjust,
                Permission::InventoryValidate,
                Permission::ConsignmentsRead,
                Permission::ConsignmentsWrite,
                Permission::SettingsRead,
                Permission::DeliveryRunsRead,
            ],
            // Un livreur ne voit que ses tournees et declare ses encaissements.
            // Il n'a NI CashOperate, NI SalesWrite, NI quoi que ce soit qui
            // touche a la caisse : c'est la garantie structurelle que son sac
            // reste separe de la caisse du depot (cf. DECISIONS_TOURNEES §2).
            // Read est indispensable : sans lui le livreur peut demarrer une
            // tournee (Execute) mais ne peut pas en lire les arrets, donc il ne
            // sait pas ou aller. Execute seul etait une impasse.
            //
            // Limite connue : Read n'est pas filtre par ligne. Un livreur voit
            // donc toutes les tournees, pas seulement les siennes. Acceptable a
            // l'echelle d'un depot (quelques livreurs) ; a filtrer par
            // driver_user_id le jour ou ca ne l'est plus.
            Role::Driver => &[
                Permission::DeliveryRunsRead,
                Permission::DeliveryRunsExecute,
            ],
            Role::Accountant => &[
                Permission::CatalogRead,
                Permission::SalesRead,
                Permission::ReceivablesRead,
                Permission::PurchasesRead,
                Permission::StockRead,
                Permission::ConsignmentsRead,
                Permission::CashRead,
                Permission::ReportsRead,
                Permission::SettingsRead,
                Permission::BackupsRead,
                Permission::DeliveryRunsRead,
            ],
        }
    }

    pub fn has_permission(self, permission: Permission) -> bool {
        self.permissions().contains(&permission)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    CatalogRead,
    CatalogWrite,
    CatalogDelete,
    SalesRead,
    SalesWrite,
    SalesCancelReturn,
    ReceivablesRead,
    ReceivablesPay,
    PurchasesRead,
    PurchasesWrite,
    SupplierDebtsPay,
    StockRead,
    StockAdjust,
    InventoryValidate,
    ConsignmentsRead,
    ConsignmentsWrite,
    CashRead,
    CashOperate,
    ExpensesWrite,
    ReportsRead,
    SettingsRead,
    SettingsWrite,
    BackupsRead,
    BackupsCreate,
    BackupsRestore,
    SecurityManageUsers,
    SecurityChangeOwnerPin,
    DeliveryRunsRead,
    DeliveryRunsManage,
    DeliveryRunsExecute,
    DeliveryRunsReconcile,
}

impl Permission {
    pub const ALL: &'static [Permission] = &[
        Permission::CatalogRead,
        Permission::CatalogWrite,
        Permission::CatalogDelete,
        Permission::SalesRead,
        Permission::SalesWrite,
        Permission::SalesCancelReturn,
        Permission::ReceivablesRead,
        Permission::ReceivablesPay,
        Permission::PurchasesRead,
        Permission::PurchasesWrite,
        Permission::SupplierDebtsPay,
        Permission::StockRead,
        Permission::StockAdjust,
        Permission::InventoryValidate,
        Permission::ConsignmentsRead,
        Permission::ConsignmentsWrite,
        Permission::CashRead,
        Permission::CashOperate,
        Permission::ExpensesWrite,
        Permission::ReportsRead,
        Permission::SettingsRead,
        Permission::SettingsWrite,
        Permission::BackupsRead,
        Permission::BackupsCreate,
        Permission::BackupsRestore,
        Permission::SecurityManageUsers,
        Permission::SecurityChangeOwnerPin,
        Permission::DeliveryRunsRead,
        Permission::DeliveryRunsManage,
        Permission::DeliveryRunsExecute,
        Permission::DeliveryRunsReconcile,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Permission::CatalogRead => "catalog:read",
            Permission::CatalogWrite => "catalog:write",
            Permission::CatalogDelete => "catalog:delete",
            Permission::SalesRead => "sales:read",
            Permission::SalesWrite => "sales:write",
            Permission::SalesCancelReturn => "sales:cancel_return",
            Permission::ReceivablesRead => "receivables:read",
            Permission::ReceivablesPay => "receivables:pay",
            Permission::PurchasesRead => "purchases:read",
            Permission::PurchasesWrite => "purchases:write",
            Permission::SupplierDebtsPay => "supplier_debts:pay",
            Permission::StockRead => "stock:read",
            Permission::StockAdjust => "stock:adjust",
            Permission::InventoryValidate => "inventory:validate",
            Permission::ConsignmentsRead => "consignments:read",
            Permission::ConsignmentsWrite => "consignments:write",
            Permission::CashRead => "cash:read",
            Permission::CashOperate => "cash:operate",
            Permission::ExpensesWrite => "expenses:write",
            Permission::ReportsRead => "reports:read",
            Permission::SettingsRead => "settings:read",
            Permission::SettingsWrite => "settings:write",
            Permission::BackupsRead => "backups:read",
            Permission::BackupsCreate => "backups:create",
            Permission::BackupsRestore => "backups:restore",
            Permission::SecurityManageUsers => "security:manage_users",
            Permission::SecurityChangeOwnerPin => "security:change_owner_pin",
            Permission::DeliveryRunsRead => "delivery_runs:read",
            Permission::DeliveryRunsManage => "delivery_runs:manage",
            Permission::DeliveryRunsExecute => "delivery_runs:execute",
            Permission::DeliveryRunsReconcile => "delivery_runs:reconcile",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub role_label: String,
    pub permissions: Vec<String>,
}

impl SessionIdentity {
    pub fn from_role(
        user_id: impl Into<String>,
        username: impl Into<String>,
        display_name: impl Into<String>,
        role: Role,
    ) -> Self {
        let permissions = role
            .permissions()
            .iter()
            .map(|p| p.code().to_string())
            .collect();
        Self {
            user_id: user_id.into(),
            username: username.into(),
            display_name: display_name.into(),
            role,
            role_label: role.label_fr().to_string(),
            permissions,
        }
    }

    pub fn owner() -> Self {
        Self::from_role("owner", "owner", "Propriétaire", Role::Owner)
    }

    pub fn has_permission(&self, permission: Permission) -> bool {
        self.role.has_permission(permission)
    }
}
