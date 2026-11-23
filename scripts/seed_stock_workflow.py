#!/usr/bin/env python3
"""
Seed de stocks, seuils d'alerte, emballages consignés, mouvements, clients et inventaire
pour DEPOTPRO PREMIUM V3+. Idempotent : réexécutable sans créer de doublons ni violer les FK.
Usage : python3 scripts/seed_stock_workflow.py [--db data/depotpro_v3.db]
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "depotpro_v3.db"

# product_id -> stock_milli (unités milli ; 1000 = 1 unité)
STOCK_BY_PRODUCT: dict[int, int] = {
    1: 288000,   # Bock Solibra 65cl  -> 288 btles (12 casiers x24)
    2: 240000,   # Bock Solibra 33cl  -> 240 btles (10 casiers x24)
    3: 480000,   # Flag Spéciale 65cl -> 480 btles (20 casiers x24)
    4: 144000,   # Beaufort Lager 50cl -> 144 btles (12 casiers x12)
    5: 240000,   # Castel Beer 33cl   -> 240 btles (10 casiers x24)
    6: 120000,   # Malta Guinness 33cl -> 120 (5 cartons x24)
    7: 120000,   # Youki Orange 30cl  -> 120
    8: 60000,    # Youki Cocktail PET 1.5L -> 60 (10 packs x6)
    9: 120000,   # Orangina 50cl      -> 120 (10 casiers x12)
    10: 144000,  # Youzou Canette 33cl -> 144 (6 cartons x24)
    11: 360000,  # Flag Spéciale 33cl -> 360 (15 casiers x24)
    12: 120000,  # Beaufort Lager Canette 33cl -> 120
    13: 144000,  # Castel Beer 65cl   -> 144 (12 casiers x12)
    14: 96000,   # Doppel Munich 50cl -> 96 (8 casiers x12)
    15: 120000,  # Chill Citron 33cl  -> 120
    16: 72000,   # Guinness Foreign Extra 33cl -> 72
    17: 72000,   # Guinness Smooth 50cl -> 72
    18: 120000,  # Malta Guinness Bouteille 33cl -> 120
    19: 96000,   # XXL Energy 33cl    -> 96
    20: 96000,   # Youki Citron 30cl  -> 96
    21: 96000,   # Youki Pomme 30cl   -> 96
    22: 96000,   # Youki Cocktail 30cl -> 96
    23: 48000,   # Youki Orange PET 1.5L -> 48
    24: 96000,   # World Cola 30cl    -> 96
    25: 48000,   # World Cola PET 1.5L -> 48
    26: 180000,  # Eau Minérale Awa 1.5L -> 180 (30 packs x6)
    27: 240000,  # Eau Minérale Awa 50cl -> 240 (10 casiers x24)
    28: 60000,   # Vin Valpierre Rouge 75cl -> 60
    29: 60000,   # Vin Valpierre Blanc 75cl -> 60
    30: 60000,   # Vin Valpierre Rosé 75cl -> 60
    31: 120000,  # Bière Ivoire Spéciale 60cl -> 120 (10 casiers x12)
    32: 144000,  # Bière Ivoire Spéciale 33cl -> 144
    33: 72000,   # Bière Ivoire Black 33cl -> 72
    34: 144000,  # Bière Ivoire Canette 33cl -> 144
    35: 96000,   # Heineken Original 33cl -> 96
    36: 96000,   # Heineken Canette 33cl -> 96
    37: 72000,   # Desperados Original 33cl -> 72
    38: 96000,   # Mützig Classique 65cl -> 96
    39: 120000,  # Maltina Classique 33cl -> 120
    40: 120000,  # Fayrouz Ananas 33cl -> 120
    41: 72000,   # Ivoire Black 60cl -> 72
    42: 96000,   # Ivoire Canette 50cl -> 96
    43: 120000,  # Ivoire Panaché 33cl -> 120
    44: 120000,  # Ivoire Fresh Citron 33cl -> 120
    45: 72000,   # Heineken Original 65cl -> 72
    46: 72000,   # Heineken Canette 50cl -> 72
    47: 72000,   # Heineken Silver 33cl -> 72
    48: 72000,   # Heineken 0.0 33cl -> 72
    49: 120000,  # Mützig Classique 33cl -> 120
    50: 120000,  # Mützig Canette 33cl -> 120
    51: 72000,   # Desperados Canette 33cl -> 72
    52: 66000,   # Amstel Lager Canette 33cl -> 66
    53: 48000,   # Strongbow Gold Apple 33cl -> 48
    54: 96000,   # Maltina Bouteille 33cl -> 96
    55: 96000,   # Maltina Vanille 33cl -> 96
    56: 96000,   # Maltina Ananas 33cl -> 96
    57: 96000,   # Fayrouz Ananas Bouteille 33cl -> 96
    58: 96000,   # Fayrouz Pomme 33cl -> 96
    59: 96000,   # Fayrouz Mangue 33cl -> 96
    60: 96000,   # Fayrouz Pêche 33cl -> 96
}

# packaging_id -> quantité consignée (unités entières)
RETURNABLE_BY_PACKAGING: dict[int, int] = {
    1: 2400,   # Bouteille verre 65cl SOLIBRA
    2: 120,    # Casier 12 alvéoles 65cl SOLIBRA
    3: 3600,   # Bouteille verre 33cl SOLIBRA
    4: 150,    # Casier 24 alvéoles 33cl SOLIBRA
    5: 1440,   # Bouteille verre 50cl SOLIBRA
    6: 120,    # Casier 12 alvéoles 50cl SOLIBRA
    7: 2400,   # Bouteille verre 30cl SOLIBRA
    8: 150,    # Casier 24 alvéoles 30cl SOLIBRA
    9: 1200,   # Bouteille verre 60/65cl BRASSIVOIRE
    10: 60,    # Casier 12 alvéoles 60/65cl BRASSIVOIRE
    11: 1800,  # Bouteille verre 33cl BRASSIVOIRE
    12: 75,    # Casier 24 alvéoles 33cl BRASSIVOIRE
}

CLIENTS = [
    ("CLI-001", "Client Comptoir", "particulier", None, "Vente directe au dépôt", "Abidjan", "forbidden", None, 0),
    ("CLI-002", "Maquis Le Prestige", "professionnel", "+225 05 44 12 88 90", "Rue des Jardins, Cocody", "Abidjan", "limited", 500000, 15),
    ("CLI-003", "Hôtel La Lagune", "professionnel", "+225 01 02 33 44 55", "Boulevard de Marseille", "Abidjan", "unlimited", None, 30),
    ("CLI-004", "Super Marché Bon Prix", "professionnel", "+225 07 00 11 22 33", "Zone 4, Yopougon", "Abidjan", "limited", 800000, 30),
    ("CLI-005", "Restaurant Le Savoureux", "professionnel", "+225 05 44 99 88 77", "Rue des Bananes, Plateau", "Abidjan", "limited", 300000, 15),
]

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed stocks et workflow inventaire DEPOTPRO V3+")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="Chemin base SQLite")
    args = ap.parse_args()

    if not args.db.exists():
        raise SystemExit(f"Base introuvable : {args.db}")

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA foreign_keys = ON")
    cur = con.cursor()

    existing_products = {
        row[0]: row[1]
        for row in cur.execute("SELECT id, purchase_price FROM products").fetchall()
    }
    if not existing_products:
        con.close()
        raise SystemExit("Aucun produit dans la table 'products'. Lancez d'abord le seed produits.")

    loc_row = cur.execute(
        "SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1"
    ).fetchone()
    location_id = loc_row[0] if loc_row else None

    existing_returnables = {
        row[0]: row[1]
        for row in cur.execute("SELECT id, deposit_value FROM returnable_packaging_types").fetchall()
    }

    seeded_products = 0
    seeded_returnables = 0

    try:
        cur.execute("BEGIN")

        # --- 1 & 2 & 3. Produits présents : stock, stock_balances, stock_movements ---
        cur.execute(
            "DELETE FROM stock_movements WHERE reference_document = 'INIT-STOCK' AND movement_type = 'purchase_in'"
        )
        for pid, cost in sorted(existing_products.items()):
            stock = STOCK_BY_PRODUCT.get(pid, 96000)
            min_stock = stock // 4
            max_stock = stock * 2
            cur.execute(
                "UPDATE products SET stock_milli = ?, min_stock_milli = ?, max_stock_milli = ? WHERE id = ?",
                (stock, min_stock, max_stock, pid),
            )
            if location_id is not None:
                bal_row = cur.execute(
                    "SELECT id FROM stock_balances WHERE product_id = ? AND variant_id IS NULL AND location_id = ?",
                    (pid, location_id),
                ).fetchone()
                if bal_row:
                    cur.execute(
                        "UPDATE stock_balances SET quantity_milli = ?, updated_at = ? WHERE id = ?",
                        (stock, NOW, bal_row[0]),
                    )
                else:
                    cur.execute(
                        "INSERT INTO stock_balances (product_id, variant_id, location_id, quantity_milli, updated_at) VALUES (?, NULL, ?, ?, ?)",
                        (pid, location_id, stock, NOW),
                    )
            cur.execute(
                "INSERT INTO stock_movements (product_id, movement_type, quantity_milli, stock_before_milli, stock_after_milli, unit_cost, reason, reference_document, location_id, created_at) VALUES (?, 'purchase_in', ?, 0, ?, ?, 'Réception initiale de stock', 'INIT-STOCK', ?, ?)",
                (pid, stock, stock, cost, location_id, NOW),
            )
            seeded_products += 1

        # --- 4. Emballages consignés : soldes + actifs + mouvements initiaux ---
        for rid, dep in sorted(existing_returnables.items()):
            qty = RETURNABLE_BY_PACKAGING.get(rid, 100)
            cur.execute(
                "INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, ?) ON CONFLICT(packaging_id) DO UPDATE SET quantity = excluded.quantity",
                (rid, qty),
            )
            cur.execute(
                "UPDATE packaging_assets SET stock_empty = ? WHERE returnable_id = ?",
                (qty, rid),
            )
            cur.execute(
                "INSERT OR REPLACE INTO returnable_stock_movements (request_key, packaging_id, movement_type, quantity, stock_before, stock_after, reason, reference_document, unit_deposit_value, total_value, date) VALUES (?, ?, 'initial', ?, 0, ?, 'Stock initial de démonstration', 'INIT-DEMO', ?, ?, ?)",
                (f"init-ret-{rid}", rid, qty, qty, dep, qty * dep, NOW),
            )
            seeded_returnables += 1

        # --- 5. Clients + paramètres de crédit (idempotent, respecte les FK) ---
        for (code, name, ctype, phone, address, city, policy, limit_val, terms) in CLIENTS:
            cur.execute(
                """INSERT INTO clients (code, name, client_type, phone, address, city)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(code) DO UPDATE SET
                     name = excluded.name,
                     client_type = excluded.client_type,
                     phone = excluded.phone,
                     address = excluded.address,
                     city = excluded.city""",
                (code, name, ctype, phone, address, city),
            )
            cid = cur.execute("SELECT id FROM clients WHERE code = ?", (code,)).fetchone()[0]
            cur.execute(
                """INSERT INTO client_credit_settings (client_id, policy, credit_limit, payment_terms_days)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(client_id) DO UPDATE SET
                     policy = excluded.policy,
                     credit_limit = excluded.credit_limit,
                     payment_terms_days = excluded.payment_terms_days""",
                (cid, policy, limit_val, terms),
            )

        # --- 6. Inventaire validé (théorique = compté) ---
        inv_row = cur.execute("SELECT id FROM inventories WHERE reference = 'INV-2026-0001'").fetchone()
        if inv_row:
            inv_id = inv_row[0]
            cur.execute("DELETE FROM inventory_lines WHERE inventory_id = ?", (inv_id,))
        else:
            cur.execute(
                "INSERT INTO inventories (reference, status, notes, created_at, validated_at) VALUES (?, 'validated', 'Inventaire initial de démarrage — stock cohérent', ?, ?)",
                ("INV-2026-0001", NOW, NOW),
            )
            inv_id = cur.execute("SELECT id FROM inventories WHERE reference = 'INV-2026-0001'").fetchone()[0]

        for pid in sorted(existing_products.keys()):
            stock = STOCK_BY_PRODUCT.get(pid, 96000)
            cur.execute(
                "INSERT INTO inventory_lines (inventory_id, product_id, theoretical_milli, counted_milli, reason) VALUES (?, ?, ?, ?, 'Conforme')",
                (inv_id, pid, stock, stock),
            )

        con.commit()
    except Exception as exc:
        con.rollback()
        print(f"Erreur, transaction annulée : {exc}", file=sys.stderr)
        return 1
    finally:
        con.close()

    print(
        f"Seed stock OK : {seeded_products} produits approvisionnés, "
        f"{seeded_returnables} emballages consignés, "
        f"{len(CLIENTS)} clients, inventaire INV-2026-0001 validé."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
