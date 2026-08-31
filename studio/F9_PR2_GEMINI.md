# F-9 PR2 Gemini — session event log + cloned useJob

**For:** Gemini / AI Studio.  
**Depends:** F-9 PR1 COMPLETE (`jobPreview.ts` + `JobSession.contract.test.ts` exist).  
**Who:** You implement. Grok reviews. Do not start PR3.

---

## A. Paste this as the Gemini prompt

```text
You are doing F-9 PR2 for Health-tracker. Read studio/F9_PR2_GEMINI.md and execute IDs F9P2-1 … F9P2-4 only.

Already done: F-9 PR1 helper/tests; TaskPlaceholderCard already JobStore.subscribes and clones. You replace that with useJob (clone inside the hook) and add a 20-event session log.

DO:
1. CREATE src/jobs/sessionLog.ts (full file in pack §E).
2. REPLACE src/hooks/useJob.ts (full file in pack §E) — clone on notify.
3. FIND→REPLACE TaskPlaceholderCard to use useJob(jobProp.id) instead of its own JobStore.subscribe. Keep jobProp.id fallback.
4. FIND→REPLACE JobStore.updateJob to recordSessionEvent (accepted) — 4 lines, pack §E.
5. Optional DEV pre of getSessionLog on the card. No new modal.

DO NOT:
- Edit AGENTS.md, docs/agent/**, App.tsx, LogChat.tsx, server_meal_edit.ts
- Add inFlightTurnAt2
- npm run build
- F-9.4 current_turn / F-9.5 apply

Gate: pack §F.
```

---

## B. Honesty

Clone is the paint fix. If you `setJob(live)` without `{ ...live }`, FAIL.

---

## C. Already DONE

PR1 helper/tests. FoodHistoryTab already `.map(j => ({ ...j }))` — leave it.

---

## D. Matrix

| Surface | Must |
|---------|------|
| useJob notify | state is a shallow copy, not Map value |
| Card | still shows Updating via previewStatusLabel |
| Session log | last 20 events, ring buffer |

---

## E. FILE SWAP

### E1. CREATE `src/jobs/sessionLog.ts`

```ts
export type SessionWriter =
  | 'LogChat.submit'
  | 'JobQueueRunner'
  | 'poller'
  | 'realtime'
  | 'r2'
  | 'JobStore.apply';

export type SessionAction = 'accepted' | 'ignored_stale_turn' | 'ignored_same_snapshot' | 'completed';

export interface SessionEvent {
  ts: number;
  writer: SessionWriter;
  turn?: number;
  status?: string;
  resultKey?: string;
  action: SessionAction;
}

const MAX = 20;
const logs = new Map<string, SessionEvent[]>();

export function recordSessionEvent(
  jobId: string,
  event: Omit<SessionEvent, 'ts'> & { ts?: number }
): SessionEvent[] {
  if (!jobId) return [];
  const row: SessionEvent = { ts: event.ts ?? Date.now(), ...event };
  const next = [...(logs.get(jobId) || []), row].slice(-MAX);
  logs.set(jobId, next);
  return next;
}

export function getSessionLog(jobId: string): SessionEvent[] {
  return logs.get(jobId) || [];
}

export function formatSessionLog(jobId: string): string {
  return getSessionLog(jobId)
    .map((e) => `${new Date(e.ts).toISOString()} ${e.writer} ${e.action} ${e.status || ''} ${e.resultKey || ''}`.trim())
    .join('\n');
}
```

### E2. REPLACE entire `src/hooks/useJob.ts`

```ts
import { useState, useEffect } from 'react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<AgentJob | undefined>(undefined);

  useEffect(() => {
    if (!jobId) {
      setJob(undefined);
      return;
    }

    const update = () => {
      const live = JobStore.getJob(jobId);
      setJob(live ? { ...live } : undefined);
    };

    update();
    const unsubscribe = JobStore.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, [jobId]);

  return {
    job,
    progressPercent: job?.progressPercent || 0,
    statusMessage: job?.statusMessage || '',
  };
}
```

### E3. FIND → REPLACE `TaskPlaceholderCard.tsx`

Add:

```
import { useJob } from '../hooks/useJob';
import { getSessionLog, formatSessionLog } from '../jobs/sessionLog';
```

Replace the `useState<AgentJob>(jobProp)` + two job-sync effects with:

```
  const live = useJob(jobProp.id).job;
  const job = live || jobProp;
```

Delete:

```
  const [job, setJob] = useState<AgentJob>(jobProp);
```

and the `useEffect` that `setJob(jobProp)` and the `useEffect` that `JobStore.subscribe(sync)`.

Keep the elapsed-seconds tick effect; it already uses `job`.

Near the status label (after `getStatusLabel` is used in JSX is fine), in DEV only:

```
      {import.meta.env.DEV && getSessionLog(job.id).length > 0 && (
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500" title={formatSessionLog(job.id)}>
          {formatSessionLog(job.id)}
        </pre>
      )}
```

If you cannot find a safe JSX slot, skip the pre — the log still exists for debug download later.

### E4. FIND in `src/jobs/JobStore.ts` after `Object.assign(job, { ...patch, updatedAt: new Date().toISOString() });`

Add import at top:

```
import { recordSessionEvent } from './sessionLog';
```

After Object.assign (before saveJobs):

```
    recordSessionEvent(id, {
      writer: 'JobStore.apply',
      status: job.status,
      action: job.status === 'succeeded' ? 'completed' : 'accepted',
    });
```

Do not change merge/status-guard logic.

### E5. CREATE `src/jobs/__tests__/sessionLog.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { recordSessionEvent, getSessionLog } from '../sessionLog';

describe('sessionLog', () => {
  it('keeps a ring buffer of 20', () => {
    for (let i = 0; i < 25; i++) {
      recordSessionEvent('ring1', { writer: 'poller', action: 'accepted', status: String(i) });
    }
    const log = getSessionLog('ring1');
    expect(log.length).toBe(20);
    expect(log[0].status).toBe('5');
    expect(log[19].status).toBe('24');
  });
});
```

Add a useJob clone unit in the same file or `src/hooks/useJob.test.ts` only if you can do it without a React Testing Library new dependency. If not, skip — Grok will add it on review. Honest residual: “no RTL”.

---

## F. Gate

```bash
npx tsc --noEmit
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/sessionLog.test.ts src/jobs/__tests__/JobStore.test.ts
```

---

## G. STATUS

| ID | Done when |
|----|-----------|
| F9P2-1 | sessionLog ring of 20 |
| F9P2-2 | useJob clones |
| F9P2-3 | Card uses useJob |
| F9P2-4 | JobStore records events; PR1 tests still pass |

---

## H. Out of scope

F-9.4, F-9.5, App.tsx, LogChat.tsx, food-calc. Next: `studio/F9_PR3_GEMINI.md`.
