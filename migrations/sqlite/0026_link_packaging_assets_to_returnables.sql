-- 0026 : relier les actifs d'emballage aux consignables
--
-- Constat corrigé : `packaging_assets.returnable_id` existe depuis la migration
-- 0019 mais la colonne n'est JAMAIS renseignée. Le seed de 0019 ne la fournit
-- pas, et `seed_demo.rs` ne la met pas non plus à jour.
--
-- Conséquence : `deliver_order` (orders/lifecycle.rs) ne peut jamais créer de
-- consigne, car il est gardé par `if let Some(rid) = returnable_id_opt`. Toute
-- la machinerie d'échéances et de conversion reste donc inerte du côté
-- commandes, alors que la vente directe (sales/create_persistence.rs) alimente
-- correctement `deposit_issues`.
--
-- Règle de correspondance retenue, déterministe et vérifiable :
--   1. La classe de compatibilité de l'actif encode le volume de la bouteille
--      (`bottle_33cl_glass`, `bottle_50cl_glass`, `bottle_65cl_glass`,
--      `bottle_100cl_glass` — cf. `compute_compatibility_class`).
--   2. Le consignable de type `crate` porte ce volume dans son code
--      (`EMB-SOL-CAS24-33` -> 33cl).
--   3. La capacité de l'actif doit égaler le nombre d'alvéoles du consignable
--      (24 pour 24×33, 12 pour 12×65).
--
-- Les actifs non consignables (`returnable = 0`, les cartons) sont laissés à
-- NULL : c'est correct, `deliver_order` les ignore déjà via `is_consigned`.
--
-- Les actifs déjà reliés ne sont pas touchés (WHERE returnable_id IS NULL) :
-- la migration est donc sans effet sur une base où le rattachement a été fait
-- à la main, et rejouable sans risque.

-- Reprise de l'échéance posée par 0015 sur la politique globale.
-- 0015 crée une politique à 30 jours par défaut ; l'interface, les bons
-- imprimés et les quatre retombées Rust de `due_date` valent 15 jours. On
-- aligne la politique sur la valeur réellement annoncée au client.
UPDATE packaging_policies
SET return_delay_days = 15,
    updated_at = datetime('now')
WHERE returnable_id IS NULL
  AND client_id IS NULL
  AND return_delay_days = 30;

-- Rattachement des actifs consignables aux consignables de type casier.
UPDATE packaging_assets
SET returnable_id = (
    SELECT rpt.id
    FROM returnable_packaging_types rpt
    WHERE rpt.kind = 'crate'
      -- même volume : la classe encode "<volume>cl", le code du consignable aussi
      AND instr(rpt.code, 'CAS') > 0
      AND (
            (packaging_assets.compatibility_class LIKE '%33cl%' AND instr(rpt.code, '-33') > 0)
         OR (packaging_assets.compatibility_class LIKE '%50cl%' AND instr(rpt.code, '-50') > 0)
         OR (packaging_assets.compatibility_class LIKE '%65cl%' AND instr(rpt.code, '-65') > 0)
         OR (packaging_assets.compatibility_class LIKE '%100cl%' AND instr(rpt.code, '-100') > 0)
      )
      -- même capacité : nombre d'alvéoles du casier
      AND CAST(
            substr(rpt.code, instr(rpt.code, 'CAS') + 3, 2)
          AS INTEGER) = packaging_assets.capacity
    -- déterminisme : le plus petit id si plusieurs consignables conviennent
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
            (packaging_assets.compatibility_class LIKE '%33cl%' AND instr(rpt.code, '-33') > 0)
         OR (packaging_assets.compatibility_class LIKE '%50cl%' AND instr(rpt.code, '-50') > 0)
         OR (packaging_assets.compatibility_class LIKE '%65cl%' AND instr(rpt.code, '-65') > 0)
         OR (packaging_assets.compatibility_class LIKE '%100cl%' AND instr(rpt.code, '-100') > 0)
      )
      AND CAST(
            substr(rpt.code, instr(rpt.code, 'CAS') + 3, 2)
          AS INTEGER) = packaging_assets.capacity
  );

CREATE INDEX IF NOT EXISTS idx_pa_returnable ON packaging_assets(returnable_id);
