# M31 — Fix the latest golden case (copy-paste into AI Studio)

**Who commits/pushes:** AI Studio only (`AGENTS.md` §4)

## A. User prompt (this is the whole request)

```text
Check the latest golden bug and fix it.

1. GET /api/golden/studio-brief  (or open Bug Tracker → Golden inbox → Copy AI Studio prompt)
2. Read attempts / learnings first. Do not retry an approach that already created a new bug (especially after iteration 5).
3. You may change catalog / plumbing only. Do NOT change expected meal numbers or delete outcome rows.
4. After each change: POST /api/golden/cases/<id>/attempt  { tried, learned, next, createdNewIssue? }
   then POST /api/golden/cases/<id>/replay
5. Stop when replay is all_green, or when you are blocked. Do not claim COMPLETE — replay decides.
6. Original photos + query are on the case (fixture.json). Do not ask the user to re-upload. Full live re-test: POST analyze with those URLs + query, then POST replay with the new log.

PRE-APPROVED for this one case only. No Stage-1 wait.
```

## B. What “done” means

Replay returns `all_green: true` (every enabled A line + every enabled B event). Human Promote is separate.

## C. Out of scope

Live Gemini vision · deleting log signatures to fake a clean log · inventing kcal targets · D1 migration
