-- 0026 : relier les actifs d'emballage aux consignables
--
-- Constat : `packaging_assets.returnable_id` existe depuis la migration 0019
-- mais la colonne n'est JAMAIS renseignée. Le seed de 0019 ne la fournit pas,
-- et `seed_demo.rs` ne la met pas non plus à jour.
--
-- Conséquence : `deliver_order` (orders/lifecycle.rs) ne peut jamais créer de
-- consigne, car il est gardé par `if let Some(rid) = returnable_id_opt`. Toute
-- la machinerie d'échéances et de conversion reste donc inerte du côté
-- commandes, alors que la vente directe (sales/create_persistence.rs) alimente
-- correctement `deposit_issues`.
--
-- La migration procède en trois temps, et l'ordre importe :
--
--   1. Aligner l'échéance de la politique globale (30 j -> 15 j).
--   2. Rattacher les actifs aux consignables DÉJÀ présents qui correspondent
--      exactement (volume + capacité).
--
-- Aucun consignable n'est créé : un test d'architecture impose que
-- `returnable_packaging_types` reste vide sur une base neuve. Les actifs sans
-- correspondance restent non rattachés, et `deliver_order` refuse alors la
-- livraison avec un message explicite plutôt que de perdre la dette.
--
-- Le rattachement ne touche que `returnable_id IS NULL` : il est rejouable et
-- n'écrase jamais un rattachement manuel.

-- ---------------------------------------------------------------------------
-- 1. Reprise de l'échéance posée par 0015
-- ---------------------------------------------------------------------------
-- 0015 crée une politique globale à 30 jours. L'interface (22 fichiers), les
-- bons imprimés remis aux clients et les quatre retombées Rust de `due_date`
-- valent 15 jours. On aligne la politique sur la valeur réellement annoncée.
UPDATE packaging_policies
SET return_delay_days = 15,
    updated_at = datetime('now')
WHERE returnable_id IS NULL
  AND client_id IS NULL
  AND return_delay_days = 30;

-- ---------------------------------------------------------------------------
-- 2. Rattachement aux consignables déjà existants (volume + capacité)
-- ---------------------------------------------------------------------------
-- Le volume est porté par `compatibility_class` (« bottle_33cl_glass » encode
-- 33cl, cf. `compute_compatibility_class`) ainsi que par le code du consignable
-- (« EMB-SOL-CAS24-33 »). La capacité doit égaler le nombre d'alvéoles, qui est
-- la partie numérique suivant « CAS » dans le code.
UPDATE packaging_assets
SET returnable_id = (
    SELECT rpt.id
    FROM returnable_packaging_types rpt
    WHERE rpt.kind = 'crate'
      AND instr(rpt.code, 'CAS') > 0
      AND (
            (packaging_assets.compatibility_class LIKE '%33cl%'  AND instr(rpt.code, '-33')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%50cl%'  AND instr(rpt.code, '-50')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%65cl%'  AND instr(rpt.code, '-65')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%100cl%' AND instr(rpt.code, '-100') > 0)
      )
      AND CAST(substr(rpt.code, instr(rpt.code, 'CAS') + 3, 2) AS INTEGER)
          = packaging_assets.capacity
    ORDER BY rpt.id
    LIMIT 1
)
WHERE packaging_assets.returnable_id IS NULL
  AND packaging_assets.returnable = 1
  AND EXISTS (
    SELECT 1
    FROM returnable_packaging_types rpt
    WHERE rpt.kind = 'crate'
      AND instr(rpt.code, 'CAS') > 0
      AND (
            (packaging_assets.compatibility_class LIKE '%33cl%'  AND instr(rpt.code, '-33')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%50cl%'  AND instr(rpt.code, '-50')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%65cl%'  AND instr(rpt.code, '-65')  > 0)
         OR (packaging_assets.compatibility_class LIKE '%100cl%' AND instr(rpt.code, '-100') > 0)
      )
      AND CAST(substr(rpt.code, instr(rpt.code, 'CAS') + 3, 2) AS INTEGER)
          = packaging_assets.capacity
  );

-- ---------------------------------------------------------------------------
-- 3. Actifs restés sans correspondance
-- ---------------------------------------------------------------------------
-- Cette migration ne crée AUCUN consignable. Un test d'architecture
-- (`lot4_fresh_db_neutral_defaults_and_schema_parity_with_node`) impose que
-- `returnable_packaging_types` reste vide sur une base neuve : une installation
-- fraîche ne doit contenir aucune donnée commerciale fictive.
--
-- Les actifs sans correspondance restent donc non rattachés. `deliver_order`
-- refuse désormais explicitement de livrer une consigne non rattachée, avec un
-- message qui indique le geste à faire (créer le consignable dans le catalogue
-- des emballages). C'est préférable à fabriquer un consignable inventé dont la
-- valeur de consigne ne correspondrait à aucune réalité commerciale.

CREATE INDEX IF NOT EXISTS idx_pa_returnable ON packaging_assets(returnable_id);
