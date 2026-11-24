// ============================================================================
// Moteur de validation de compatibilité des paniers POS
// ============================================================================

use std::collections::{HashMap, HashSet};

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::CoreResult;
use crate::infrastructure::db::DepotDb;

use super::rules_and_config::{get_compatibility_rules, get_pos_validation_config};
use super::{SaleLineItem, ValidateSaleInput, ValidationIssue, ValidationResultDto};

pub async fn validate_sale_compatibility(
    db: &DepotDb,
    input: ValidateSaleInput,
) -> CoreResult<ValidationResultDto> {
    require_current_actor_permission(Permission::SalesRead)?;

    let config = get_pos_validation_config(db, &input.terminal_id).await?;
    let rules = get_compatibility_rules(db).await?;

    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    for rule in rules {
        if !rule.is_active {
            continue;
        }

        match rule.rule_type.as_str() {
            "same_crate" => {
                if rule.required_quantity <= 0 {
                    continue;
                }
                let crate_groups = group_by_crate_type(&input.line_items);
                for (_crate_type, items) in crate_groups {
                    let total_bottles: i64 = items.iter().map(|item| item.quantity).sum();
                    let total_supports: i64 = items.iter().map(|item| item.support_quantity).sum();
                    let bottles_valid = total_bottles % rule.required_quantity == 0;
                    let supports_valid = total_supports % rule.required_quantity == 0;
                    let severity = match config.compatibility_validation_level.as_str() {
                        "strict" => {
                            if !bottles_valid || !supports_valid {
                                "error"
                            } else {
                                "info"
                            }
                        }
                        "warning" => {
                            if !bottles_valid && !supports_valid {
                                "error"
                            } else if !bottles_valid || !supports_valid {
                                "warning"
                            } else {
                                "info"
                            }
                        }
                        _ => "info",
                    };
                    if severity == "error" || severity == "warning" {
                        let affected_lines: Vec<i64> =
                            items.iter().map(|item| item.line_index).collect();
                        let message = if !bottles_valid && !supports_valid {
                            format!(
                                "Le nombre de bouteilles ({}) et de supports ({}) ne correspondent pas à la capacité du casier ({})",
                                total_bottles, total_supports, rule.required_quantity
                            )
                        } else if !bottles_valid {
                            format!(
                                "Le nombre de bouteilles ({}) ne correspond pas à la capacité du casier ({})",
                                total_bottles, rule.required_quantity
                            )
                        } else {
                            format!(
                                "Le nombre de supports ({}) ne correspond pas à la capacité du casier ({})",
                                total_supports, rule.required_quantity
                            )
                        };
                        let issue = ValidationIssue {
                            rule_type: rule.rule_type.clone(),
                            severity: severity.to_string(),
                            message,
                            affected_lines,
                        };
                        if severity == "error" {
                            errors.push(issue);
                        } else {
                            warnings.push(issue);
                        }
                    }
                }
            }
            "same_brand" => {
                let crate_groups = group_by_crate_type(&input.line_items);
                for (crate_type_id, items) in crate_groups {
                    if items.len() > 1 && has_multiple_brands(&items, db).await? {
                        let severity = match config.compatibility_validation_level.as_str() {
                            "strict" => "error",
                            "warning" => "warning",
                            _ => "info",
                        };
                        if severity == "error" || severity == "warning" {
                            let affected_lines: Vec<i64> =
                                items.iter().map(|item| item.line_index).collect();
                            let issue = ValidationIssue {
                                rule_type: rule.rule_type.clone(),
                                severity: severity.to_string(),
                                message: rule.error_message.clone().unwrap_or_else(|| {
                                    format!(
                                        "Mélange de marques non autorisé dans le casier #{}",
                                        crate_type_id
                                    )
                                }),
                                affected_lines,
                            };
                            if severity == "error" {
                                errors.push(issue);
                            } else {
                                warnings.push(issue);
                            }
                        }
                    }
                }
            }
            "same_family" => {
                let crate_groups = group_by_crate_type(&input.line_items);
                for (crate_type_id, items) in crate_groups {
                    if items.len() > 1 && has_multiple_categories(&items, db).await? {
                        let severity = match config.compatibility_validation_level.as_str() {
                            "strict" => "error",
                            "warning" => "warning",
                            _ => "info",
                        };
                        if severity == "error" || severity == "warning" {
                            let affected_lines: Vec<i64> =
                                items.iter().map(|item| item.line_index).collect();
                            let issue = ValidationIssue {
                                rule_type: rule.rule_type.clone(),
                                severity: severity.to_string(),
                                message: rule.error_message.clone().unwrap_or_else(|| {
                                    format!(
                                        "Mélange de familles/catégories de produits dans le casier #{}",
                                        crate_type_id
                                    )
                                }),
                                affected_lines,
                            };
                            if severity == "error" {
                                errors.push(issue);
                            } else {
                                warnings.push(issue);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let can_proceed = errors.is_empty() || config.compatibility_validation_level != "strict";

    Ok(ValidationResultDto {
        is_valid: errors.is_empty(),
        can_proceed,
        issues: warnings
            .iter()
            .cloned()
            .chain(errors.iter().cloned())
            .collect(),
        warnings,
        errors,
    })
}

fn group_by_crate_type(line_items: &[SaleLineItem]) -> HashMap<i64, Vec<SaleLineItem>> {
    let mut groups: HashMap<i64, Vec<SaleLineItem>> = HashMap::new();
    for item in line_items {
        if let Some(crate_type_id) = item.crate_type_id {
            groups.entry(crate_type_id).or_default().push(item.clone());
        }
    }
    groups
}

async fn has_multiple_brands(items: &[SaleLineItem], db: &DepotDb) -> CoreResult<bool> {
    let mut brands = HashSet::new();
    for item in items {
        let brand = sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(b.code, NULLIF(trim(p.brand), ''), 'unknown')
             FROM products p
             LEFT JOIN brands b ON b.id = p.brand_id
             WHERE p.id = ?",
        )
        .bind(item.product_id)
        .fetch_optional(&db.pool)
        .await?
        .unwrap_or_else(|| "unknown".to_string());
        brands.insert(brand);
    }
    Ok(brands.len() > 1)
}

async fn has_multiple_categories(items: &[SaleLineItem], db: &DepotDb) -> CoreResult<bool> {
    let mut categories = HashSet::new();
    for item in items {
        let category = sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(c.name, 'unknown')
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.id = ?",
        )
        .bind(item.product_id)
        .fetch_optional(&db.pool)
        .await?
        .unwrap_or_else(|| "unknown".to_string());
        categories.insert(category);
    }
    Ok(categories.len() > 1)
}
