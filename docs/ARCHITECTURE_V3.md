# ARCHITECTURE DEPOTPRO PREMIUM V3

## Principes directeurs

1. **Séparation stricte UI / Métier** : Aucune logique SQL ni aucun calcul financier autoritaire dans les composants React.
2. **Contrat API unifié (`ApiClient`)** : Le frontend passe par `src/services/api/createApiClient.ts` qui bascule entre `HttpApiClient` (mode Web local) et `TauriApiClient` (mode Desktop Tauri 2).
3. **Exécution Web locale sur port 3000** : le binaire Axum `crates/depotpro-server` sert l'API `/api/*` et le bundle `dist/`, adossé à `crates/depotpro-core` et à SQLite WAL. Il n'existe **plus** de serveur Node/Express ni d'accès `node:sqlite` : le cœur Rust est la seule implémentation métier, partagée entre Web et Desktop.
4. **Cœur Rust & Desktop Tauri 2** :
   - `crates/depotpro-core` : types `Money(i64)` et `Quantity { milli_units: i64 }`, connexion SQLx (`WAL`, `FULL`, `foreign_keys`, `busy_timeout`), verrou d'écriture unique.
   - `crates/depotpro-server` : binaire Axum local (`127.0.0.1`).
   - `src-tauri` : enveloppe Tauri 2 avec capabilities minimales et stockage dans `app_data_dir`.
