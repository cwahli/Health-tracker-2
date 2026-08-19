-- Q-6: one work item on issue_tags (Bug field + commits + burns + current evidence)
ALTER TABLE public.issue_tags
  ADD COLUMN IF NOT EXISTS work_item JSONB;

COMMENT ON COLUMN public.issue_tags.work_item IS
  'Q-6 card: { public_n, bug, class, fingerprint, burns, commits, current_evidence, hold_refs, queue }. Snap pre-fills bug; never wipe.';
