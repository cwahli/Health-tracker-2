-- Food catalog and resolution tables migration

CREATE TABLE IF NOT EXISTS public.food_items (
  food_id text PRIMARY KEY,
  food_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  form_tags text[] NULL,
  state text NULL,
  nutrients_per_100g jsonb NOT NULL,
  fdc_id text NULL,
  status text NOT NULL DEFAULT 'active',
  confidence real DEFAULT 0.5,
  capture_count int NOT NULL DEFAULT 1,
  provenance text NULL,
  parent_id text NULL,
  version int NOT NULL DEFAULT 1,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.food_aliases (
  alias_key text PRIMARY KEY,
  food_id text NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  source text NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dish_cache (
  dish_key text PRIMARY KEY,
  display_name text NOT NULL,
  core_nutrients jsonb NOT NULL,
  basis_type text NOT NULL DEFAULT 'per_serving',
  serving_grams real NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active',
  confidence real DEFAULT 0.5,
  capture_count int NOT NULL DEFAULT 1,
  provenance text NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dish_aliases (
  alias_key text PRIMARY KEY,
  dish_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.food_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE NULL,
  event_type text NOT NULL,
  snapshots jsonb NULL,
  payload jsonb NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.food_catalog_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_items_status ON public.food_items(status);
CREATE INDEX IF NOT EXISTS idx_dish_cache_status ON public.dish_cache(status);
