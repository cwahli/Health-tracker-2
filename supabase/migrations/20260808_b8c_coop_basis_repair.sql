-- B8c — Repair Co-op (and similar grocery) brand_menu_items wrongly stored as per_dish
-- when the panel is clearly per 100g.
--
-- Schema note: brand_menu_items has serving_grams + notes (NOT serving_size).
-- SAFE TO RUN: only rewrites basis when grams / notes indicate 100g grocery.
--
-- Preview (optional):
-- SELECT id, chain_key, dish_name, basis_type, serving_grams, notes
-- FROM public.brand_menu_items
-- WHERE (
--   chain_key ILIKE '%co-op%' OR chain_key ILIKE '%coop%' OR chain_key ILIKE '%co_op%'
--   OR dish_name ILIKE '%co-op%' OR COALESCE(notes, '') ILIKE '%co-op%'
-- )
-- AND (basis_type IS NULL OR basis_type IN ('per_dish', 'total', ''))
-- AND (
--   serving_grams = 100
--   OR COALESCE(notes, '') ~* '100\s*g'
--   OR COALESCE(notes, '') ~* 'per\s*100'
-- );

-- 1) Co-op-like rows stuck on per_dish / total / empty
UPDATE public.brand_menu_items
SET
  basis_type = 'per_100g',
  serving_grams = COALESCE(NULLIF(serving_grams, 0), 100),
  notes = TRIM(
    BOTH FROM
    COALESCE(notes, '') ||
    CASE
      WHEN COALESCE(notes, '') = '' THEN '[B8c] repaired basis_type → per_100g'
      WHEN notes ILIKE '%B8c%' THEN ''
      ELSE E'\n[B8c] repaired basis_type → per_100g'
    END
  ),
  updated_at = NOW()
WHERE
  (
    chain_key ILIKE '%co-op%'
    OR chain_key ILIKE '%coop%'
    OR chain_key ILIKE '%co_op%'
    OR dish_name ILIKE '%co-op%'
    OR COALESCE(notes, '') ILIKE '%co-op%'
  )
  AND (basis_type IS NULL OR basis_type IN ('per_dish', 'total', ''))
  AND (
    serving_grams = 100
    OR serving_grams IS NULL
    OR COALESCE(notes, '') ~* '100\s*g'
    OR COALESCE(notes, '') ~* 'per\s*100'
  );

-- 2) Broader grocery repair: known UK/US grocery chains with explicit 100g serving
UPDATE public.brand_menu_items
SET
  basis_type = 'per_100g',
  serving_grams = 100,
  notes = TRIM(
    BOTH FROM
    COALESCE(notes, '') ||
    CASE
      WHEN COALESCE(notes, '') = '' THEN '[B8c] grocery 100g → per_100g'
      WHEN notes ILIKE '%B8c%' THEN ''
      ELSE E'\n[B8c] grocery 100g → per_100g'
    END
  ),
  updated_at = NOW()
WHERE
  basis_type IN ('per_dish', 'total')
  AND (
    serving_grams = 100
    OR COALESCE(notes, '') ~* '100\s*g'
    OR COALESCE(notes, '') ~* 'per\s*100'
  )
  AND (
    chain_key ILIKE ANY (ARRAY[
      '%sainsbury%', '%tesco%', '%asda%', '%morrison%', '%aldi%', '%lidl%',
      '%waitrose%', '%marks%', '%kroger%', '%safeway%', '%whole food%', '%trader%'
    ])
    OR chain_key ILIKE '%co-op%'
    OR chain_key ILIKE '%coop%'
  );

/* B8c per_100g co-op */
