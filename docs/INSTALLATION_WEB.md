# Installation & Démarrage Web — DEPOTPRO PREMIUM V3

## Prérequis

- **Node.js `>= 22.0`** et `npm` (frontend React/Vite : build, contrôles, tests web).
- **Toolchain Rust stable** (`rustc`, `cargo`) : **obligatoire**, l'API est servie par `crates/depotpro-server`.
- **Navigateur moderne** (Chromium, Firefox, Edge ou Safari récent) pour l'interface React et l'impression PDF.

## 1. Mode Web : frontend Vite + API Axum

### Installation des dépendances
```bash
npm install
```

### Variables d'environnement optionnelles
- `PORT` : port HTTP d'écoute (défaut `3000`).
- `DEPOTPRO_DB_PATH` : chemin du fichier SQLite V3 (défaut `./data/depotpro_v3.db`).
- `DEPOTPRO_BACKUP_DIR` : répertoire des sauvegardes (défaut `<dossier_DB>/Sauvegardes`).

### Démarrage en développement
```bash
npm run dev          # terminal 1 : frontend Vite
npm run dev:server   # terminal 2 : API Axum sur http://127.0.0.1:3000
```
Le serveur applique automatiquement les migrations de `migrations/sqlite/` si la
base n'existe pas encore, puis initialise les données de référence minimales
(`payment_methods`, `app_settings`).

### Build et démarrage en production
```bash
npm run build
NODE_ENV=production npm start
```
`npm run build` génère les assets frontend dans `dist/`, puis `npm start`
(`NODE_ENV=production cargo run -p depotpro-server`) sert simultanément l'API
`/api/*` et le bundle statique `dist/` sur le port `3000`.

### Premier accès
Aucun code PIN par défaut n'est préconfiguré. À la première ouverture, l'écran de configuration demande la création du **code PIN propriétaire à 6 chiffres**.

## 2. Mode Serveur Rust Axum (`crates/depotpro-server`, poste équipé Rust)

Sur une machine disposant de `rustc` et `cargo` :
```bash
npm run build
cargo run --release --manifest-path crates/depotpro-server/Cargo.toml
```
Par défaut, `depotpro-server` :
- Écoute sur `127.0.0.1:3000` (configurable via `DEPOTPRO_HOST` et `PORT`).
- Utilise `./data/depotpro_v3.db` (`DEPOTPRO_DB_PATH`) et `./data/Sauvegardes` (`DEPOTPRO_BACKUP_DIR`).
- Sert le dossier `dist/` avec fallback SPA vers `index.html`, ainsi que l'API REST `/api/*`.
- Traite les échéances d'emballages au démarrage puis périodiquement (`DEPOTPRO_OBLIGATIONS_INTERVAL_SECS`, défaut `900`, minimum `60`).
