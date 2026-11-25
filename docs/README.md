# Documentation DEPOTPRO V3

Ce dossier contient la documentation technique et métier du projet. Certaines notes sont historiques (lots d’évolution, remédiations, audits, prompts) ; se référer en priorité aux documents canoniques ci-dessous.

## Documents canoniques

| Document | Rôle |
|---|---|
| [`../README.md`](../README.md) | Vue d’ensemble, démarrage, architecture, commandes, état vérifié |
| [`BUSINESS_RULES.md`](BUSINESS_RULES.md) | Règles métier (argent, stock, caisse, crédit, consignations) |
| [`API.md`](API.md) | Contrats HTTP/Tauri et conventions API |
| [`DATABASE.md`](DATABASE.md) | Schéma SQLite, contraintes, invariants de données |
| [`SECURITY.md`](SECURITY.md) | Authentification, sessions, permissions, sécurité desktop |
| [`FRONTEND.md`](FRONTEND.md) | Architecture React, client API, écrans/documents |
| [`TESTING.md`](TESTING.md) | Stratégie de tests, commandes, couverture |
| [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) | Sauvegarde, vérification, restauration |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Incidents courants et diagnostic |
| [`INSTALLATION_WEB.md`](INSTALLATION_WEB.md) | Installation/exécution web |
| [`INSTALLATION_WINDOWS.md`](INSTALLATION_WINDOWS.md) | Build/installation Windows |
| [`INSTALLATION_MACOS.md`](INSTALLATION_MACOS.md) | Build/installation macOS |

## Sources de vérité code

- **Migrations SQLite runtime** : `crates/depotpro-core/src/infrastructure/db/sql_defs.rs` (`MIGRATIONS`, `CURRENT_SCHEMA_VERSION`) ; fichiers SQL dans `migrations/sqlite/`.
- **Règles métier exécutables** : `crates/depotpro-core/src/domain/*` et `crates/depotpro-core/src/application/*`.
- **Contrat API client** : `src/services/api/contracts/*` et `src/services/api/ApiClient.ts`.
- **Routes serveur** : `crates/depotpro-server/src/router/*`.
- **Commandes Tauri** : `src-tauri/src/lib.rs` et `src-tauri/src/commands/*`.

## Documents historiques / contexte

Les fichiers `EVOLUTION_LOT_*`, `REMEDIATION_*`, `AUDIT_*`, `MASTER_PROMPT_*`, `CDC_*`, rapports d’analyse et plans de lot conservent le contexte de décision. Ils peuvent décrire un état antérieur ; en cas de divergence, le code et les documents canoniques priment.
