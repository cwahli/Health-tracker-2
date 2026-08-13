-- Tiny metadata only. Logs, scout JSON, attempts live on R2.
CREATE TABLE IF NOT EXISTS public.golden_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id text,
  job_id text,
  title text NOT NULL DEFAULT 'Untitled golden',
  status text NOT NULL DEFAULT 'open',
  r2_prefix text NOT NULL,
  pass_count int NOT NULL DEFAULT 0,
  fail_count int NOT NULL DEFAULT 0,
  iteration int NOT NULL DEFAULT 0,
  all_green boolean NOT NULL DEFAULT false,
  last_replay_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS golden_cases_status_idx ON public.golden_cases (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS golden_cases_job_idx ON public.golden_cases (job_id);

COMMENT ON TABLE public.golden_cases IS
  'Golden meal inbox metadata. Heavy debug/scout/attempts JSON is on R2 under r2_prefix.';
