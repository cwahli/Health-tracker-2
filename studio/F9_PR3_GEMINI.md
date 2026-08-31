# F-9 PR3 Gemini — current_turn is the session

**For:** Gemini / AI Studio.  
**Depends:** F-9 PR1 tests green. PR2 preferred.  
**Who:** You do migration, types, serverJobs, JobStore turn guard. Grok packed LogChat FIND strings — use them; if unique-match fails, **stop** and leave LogChat to Grok. Do not rewrite LogChat.

---

## A. Paste this as the Gemini prompt

```text
You are doing F-9 PR3 for Health-tracker. Read studio/F9_PR3_GEMINI.md and execute F9P3-1 … F9P3-5.

Goal: currentTurn integer. Incoming row with current_turn < local is dropped. Running submit nulls clean_result (already) and AWAITS that upsert (timeout 2000ms) before analyze setImmediate. Preview still uses jobPreview helpers from PR1.

DO the files in pack §E. Keep inFlightTurnAt as fallback if currentTurn is missing. Do not invent a new flag.

DO NOT:
- Rewrite App.tsx
- Rewrite LogChat.tsx beyond the two FIND blocks in §E (if they fail to match, skip LogChat and note residual)
- food-calc files, AGENTS.md, npm run build, F-9.5 apply()

Gate: pack §F. JobSession.contract.test.ts must still pass.
```

---

## B. Honesty

If you delete `inFlightTurnAt` and PR1 tests go red, **restore it** and list residual. Do not add `inFlightTurnAt2`.

---

## C. Already DONE

PR1 helper/tests. `submitServerJob` already sets `clean_result: null` on the in-memory record.

---

## D. Matrix

| Event | current_turn |
|-------|----------------|
| First submit | 1 |
| Edit / retry after succeeded\|awaiting_user\|failed | previous + 1 |
| Incoming row turn < local | ignore status+result |
| Running | clean_result null |

---

## E. FILE SWAP / FIND → REPLACE

### E1. CREATE `supabase/migrations/20260831_agent_jobs_current_turn.sql`

```sql
ALTER TABLE public.agent_jobs
  ADD COLUMN IF NOT EXISTS current_turn INT NOT NULL DEFAULT 1;
```

### E2. FIND in `src/jobs/types.ts` after `inFlightTurnAt?: number;`

**REPLACE that field plus the new one:**

```
  /** Epoch ms when the current edit/analyze turn started. Preview stays in processing until a later finishedAt. */
  inFlightTurnAt?: number;
  /** Session turn. Increments on every submit. Incoming rows with a smaller turn are ignored. */
  currentTurn?: number;
```

### E3. FIND in `serverJobs.ts` the `initialJobRecord` object. Add `current_turn` computed **above** it:

**FIND:**

```
  const existingMemJob = inMemoryServerJobs.get(jobId);
  const turn1Logs: string[] = (existingMemJob?.turn1Logs && existingMemJob.turn1Logs.length > 0)
```

**REPLACE:**

```
  const existingMemJob = inMemoryServerJobs.get(jobId);
  const prevTurn = Number(existingMemJob?.current_turn ?? existingMemJob?.currentTurn ?? 1) || 1;
  const isContinuation = !!(
    existingMemJob &&
    (existingMemJob.status === 'succeeded' || existingMemJob.status === 'awaiting_user' || existingMemJob.status === 'failed')
  );
  const currentTurn = isContinuation ? prevTurn + 1 : (existingMemJob?.current_turn ?? existingMemJob?.currentTurn ?? 1) || 1;
  const turn1Logs: string[] = (existingMemJob?.turn1Logs && existingMemJob.turn1Logs.length > 0)
```

**FIND** inside `initialJobRecord`:

```
    clean_result: null,
    error: null,
    debug_url: null,
    updated_at: new Date().toISOString()
```

**REPLACE:**

```
    clean_result: null,
    current_turn: currentTurn,
    error: null,
    debug_url: null,
    updated_at: new Date().toISOString()
```

**FIND** the fire-and-forget upsert block (the comment about never blocking 502). **REPLACE the IIFE with an awaited timeout** so realtime cannot emit the old completed row after submit returned 200. Analyze stays in `setImmediate` (do not await analyze).

```
  if (isSupabaseConfigured) {
    const upsertOnce = (async () => {
      try {
        const { turn1Logs, accumulatedLogs, ...dbRecord } = initialJobRecord;
        const { error } = await supabaseAdmin.from('agent_jobs').upsert(dbRecord, { onConflict: 'id' });
        if (error) {
          console.error('[ServerJobs] initial upsert failed:', error);
        }
      } catch (e: any) {
        console.error('[ServerJobs] initial upsert threw:', e);
      }
    })();
    await Promise.race([
      upsertOnce,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
```

Do **not** put this await after `setImmediate` analyze. Order: write memory → await upsert (≤2s) → setImmediate analyze.

Progress updates must not set `clean_result`. Terminal writes leave `current_turn` as-is.

### E4. JobStore.updateJob — at the top of the function after `const job = this.jobs.get(id); if (!job) return;`

**INSERT:**

```
    const incomingTurn = (patch as any).currentTurn ?? (patch as any).current_turn;
    if (typeof incomingTurn === 'number' && typeof job.currentTurn === 'number' && incomingTurn < job.currentTurn) {
      delete patch.status;
      delete patch.result;
      delete patch.messages;
      delete patch.finishedAt;
      delete patch.statusMessage;
      delete patch.inFlightTurnAt;
    }
```

On explicit submit (`patch.clientSubmitPending === true`), allow `currentTurn` to increase.

### E5. LogChat.tsx — only if unique match.

**FIND** (the existing-job `updateJob` on send):

```
            serverSubmittedAt: Date.now(),
            inFlightTurnAt: Date.now(),
            finishedAt: undefined,
            clientSubmitPending: true,
            statusMessage: submissionMode === 'edit' ? 'Updating meal...' : 'Uploading to server… Keep this tab open',
          });
        } else {
          JobStore.createJob({
```

**REPLACE:**

```
            serverSubmittedAt: Date.now(),
            inFlightTurnAt: Date.now(),
            currentTurn: (job.currentTurn || 1) + 1,
            finishedAt: undefined,
            clientSubmitPending: true,
            statusMessage: submissionMode === 'edit' ? 'Updating meal...' : 'Uploading to server… Keep this tab open',
          });
        } else {
          JobStore.createJob({
```

**FIND** in createJob branch:

```
            serverSubmittedAt: Date.now(),
            inFlightTurnAt: Date.now(),
            finishedAt: undefined,
            clientSubmitPending: true,
            statusMessage: submissionMode === 'edit' ? 'Updating meal...' : 'Uploading to server… Keep this tab open',
          });
        }
```

**REPLACE** — add `currentTurn: 1,` after `inFlightTurnAt: Date.now(),`.

If either FIND fails, **skip LogChat** and write residual in COMPLETE. Do not fuzzy-rewrite the 7k-line file.

`/api/jobs/status` payloads should include `current_turn` if you already map the row; if the mapper is non-obvious, skip (honest residual).

---

## F. Gate

```bash
npx tsc --noEmit
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts
node scripts/assert-dev-serves-vite.mjs
```

Add one test in `JobStore.test.ts` (append, do not rewrite the file):

```
  it('drops succeeded echoes from a lower currentTurn', () => {
    JobStore.createJob({
      id: 'turn-n',
      status: 'queued',
      currentTurn: 2,
      inFlightTurnAt: Date.now(),
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
    });
    JobStore.updateJob('turn-n', {
      status: 'succeeded',
      currentTurn: 1,
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
    });
    expect(JobStore.getJob('turn-n')?.status).toBe('queued');
    expect(JobStore.getJob('turn-n')?.currentTurn).toBe(2);
  });
```

---

## G. STATUS

| ID | Done when |
|----|-----------|
| F9P3-1 | migration column default 1 |
| F9P3-2 | types.currentTurn |
| F9P3-3 | serverJobs increments + awaits upsert ≤2s |
| F9P3-4 | JobStore ignores lower currentTurn |
| F9P3-5 | LogChat increments or residual noted |

---

## H. Out of scope

F-9.5 `apply()`. Do not delete `inFlightTurnAt` unless PR1 tests stay green without it. Next: `studio/F9_PR4_GEMINI.md`. Grok owns App.tsx / remaining LogChat if you skipped it.
