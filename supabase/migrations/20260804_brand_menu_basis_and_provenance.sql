ALTER TABLE public.brand_menu_items
  ADD COLUMN IF NOT EXISTS basis_type text NOT NULL DEFAULT 'per_100g';
ALTER TABLE public.brand_menu_items
  ADD COLUMN IF NOT EXISTS provenance text NULL;
ALTER TABLE public.brand_menu_items
  ADD COLUMN IF NOT EXISTS confidence real NULL DEFAULT 0.5;
ALTER TABLE public.brand_menu_items
  ADD COLUMN IF NOT EXISTS capture_count int NOT NULL DEFAULT 1;
ALTER TABLE public.brand_menu_items
  ADD COLUMN IF NOT EXISTS nutrients_per_100g jsonb NULL;
