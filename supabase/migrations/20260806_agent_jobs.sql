CREATE TABLE IF NOT EXISTS public.agent_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'queued',
  progress_percent INT DEFAULT 0,
  status_message TEXT,
  photo_url TEXT,
  debug_url TEXT,
  clean_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE agent_jobs;

ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own jobs"
ON public.agent_jobs
FOR SELECT
USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- We won't allow direct client inserts/updates since we want them to go through the server
-- (or we could, but server handles it now for R2 credentials isolation).
