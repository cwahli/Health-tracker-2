-- Initiative K: Identified problems brief for bug tags (agent + human editable)
ALTER TABLE public.issue_tags
  ADD COLUMN IF NOT EXISTS identified_problems TEXT;

COMMENT ON COLUMN public.issue_tags.identified_problems IS
  'Consolidated diagnosis for coding agents; filled by bug_triage digest or human edit';
