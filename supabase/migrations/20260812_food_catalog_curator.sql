-- Add curator columns
ALTER TABLE public.food_aliases ADD COLUMN IF NOT EXISTS hit_count int DEFAULT 1;

ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS brand_key text NULL;
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS entity_kind text NULL DEFAULT 'generic';
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS basis_type text NULL DEFAULT 'per_100g';
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS density_factor real NULL;
