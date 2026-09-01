# F-9 PR1 Gemini — session contract tests + preview helper

**For:** Gemini / AI Studio.  
**Spec:** `plan/ROADMAP.md` F-9.1–F-9.2 · class `STALE_TURN`.  
**Who:** You implement. Grok reviews. Do not start PR2/PR3.

Grok already landed laws, ROADMAP F-9, `assert-dev-serves-vite.mjs`, IMPACT layer, blast-radius list. You do **not** edit `AGENTS.md` or `docs/agent/**`.

---

## A. Paste this as the Gemini prompt

```text
You are doing F-9 PR1 for Health-tracker. Read studio/F9_PR1_GEMINI.md and execute IDs F9P1-1 … F9P1-4 only.

Already done (do not rebuild): AGENTS.md STALE_TURN + job-lifecycle blast list; TEMPLATES.md IMPACT layer; DOMAIN_REGRESSION_MAP job-session row; sync.md current-turn laws; scripts/assert-dev-serves-vite.mjs; plan/ROADMAP.md F-9 table; inFlightTurnAt bandage in JobStore (keep it this PR).

DO:
1. Add src/jobs/jobPreview.ts — FULL FILE in pack §E. Pure helper. No JobStore import.
2. Add src/jobs/__tests__/JobSession.contract.test.ts — FULL FILE in pack §E.
3. FIND→REPLACE TaskPlaceholderCard.tsx to import and call previewStatus / previewStatusLabel / isEditJob / isTurnInFlight. Keep the card’s queuedAhead JobStore lookup.
4. Run pack §F gates. Do not claim COMPLETE without named vitest exit 0.

DO NOT:
- Edit AGENTS.md, docs/agent/**, plan/QUALITY.md
- Edit server_meal_edit.ts, agents/dietitianInstructions.ts, server_food_analyze_run.ts
- Rewrite App.tsx or LogChat.tsx
- Invent inFlightTurnAt2 / another snapshot-key flag
- Delete mergeFoodEditMessages.ts or inFlightTurnAt
- npm run build (that serves stale dist/)
- Mix F-8.10, F-9.3, F-9.4, F-9.5

Gate: pack §F.
```

---

## B. Honesty / anti-miss

- 868 green tests is **not** COMPLETE. Named `JobSession.contract.test.ts` must pass.
- Helper must return **Updating meal...** while an edit turn is in flight even if `job.status === 'succeeded'` and `pendingFoodLog` is still the old meal. That is the bug class.
- Card FIND/REPLACE only. Do not restyle the card.

---

## C. Already DONE — do not rebuild

| Piece | Where |
|-------|--------|
| Vite vs dist boot | `server.ts` `forceVite` / `assert-dev-serves-vite.mjs` |
| JobStore same-meal echo guard | `JobStore.ts` `inFlightTurnAt` + `mealSnapshotKey` |
| Chat one-card merge | `mergeFoodEditMessages.ts` + its test |
| Laws / IMPACT / map | `AGENTS.md` L1/L11/L14, `TEMPLATES.md`, `DOMAIN_REGRESSION_MAP.md` |

---

## D. Path matrix

| Surface | Must show |
|---------|-----------|
| Edit submit, prior 660 kcal still on job | label matches `/Updating meal/` |
| Realtime succeeded echo of 660 / Sweet Iced Tea | still Updating, not Analysis completed |
| New snapshot 650 / Unsweetened Iced Tea 0 | Analysis completed |
| Chat merge | one `pendingFoodLog` card (existing test; do not break) |
| First-photo analyze (not edit) | not forced to “Updating meal...” |

---

## E. FILE SWAP / FIND → REPLACE

### E1. CREATE `src/jobs/jobPreview.ts` (full file)

```ts
import { AgentJob, JobStatus } from './types';

export function isTurnInFlight(
  job: Pick<AgentJob, 'status' | 'inFlightTurnAt' | 'finishedAt'> & { currentTurn?: number }
): boolean {
  if (typeof job.inFlightTurnAt === 'number') {
    return !job.finishedAt || new Date(job.finishedAt).getTime() < job.inFlightTurnAt;
  }
  if (typeof job.currentTurn === 'number') {
    return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
  }
  return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
}

export function previewStatus(job: AgentJob): AgentJob['status'] {
  if (isTurnInFlight(job) && (job.status === 'succeeded' || job.status === 'awaiting_user')) {
    return 'running';
  }
  return job.status;
}

export function isEditJob(job: Pick<AgentJob, 'mode' | 'inputSnapshot' | 'messages'>): boolean {
  return (
    job.inputSnapshot?.mode === 'edit' ||
    job.mode === 'edit' ||
    job.mode === 'modify' ||
    !!(job.messages && job.messages.filter((m: any) => !m.isLive).length > 2)
  );
}

function isPreviewFailed(job: AgentJob, lastMsgContent?: string): boolean {
  const effectiveStatus = previewStatus(job);
  if (effectiveStatus === 'failed' || effectiveStatus === 'cancelled' || effectiveStatus === 'cancel_requested') {
    return true;
  }
  if (effectiveStatus === 'succeeded') return false;
  return (
    !!job.error ||
    (typeof job.statusMessage === 'string' && /(?:timed out|analysis failed|server error)/i.test(job.statusMessage) && !/analysis complete/i.test(job.statusMessage)) ||
    (typeof job.result?.message === 'string' && /(?:timed out|analysis failed)/i.test(job.result.message)) ||
    (typeof job.result?.error === 'string' && !!job.result.error) ||
    (typeof lastMsgContent === 'string' && /(?:timed out|analysis failed|server error)/i.test(lastMsgContent) && !job.result?.pendingFoodLog && !job.result?.modificationCommand && !job.result?.extractedData)
  );
}

export function previewStatusLabel(
  job: AgentJob,
  opts?: { queuedAhead?: number; lastMsgContent?: string }
): string {
  const effectiveStatus = previewStatus(job);
  const edit = isEditJob(job);
  if (effectiveStatus === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
    return 'AI advice pending';
  }
  if (isPreviewFailed(job, opts?.lastMsgContent)) {
    return 'Analysis failed';
  }
  const statusKey = effectiveStatus as JobStatus;
  switch (statusKey) {
    case 'queued': {
      if (edit) return 'Updating meal • Queued';
      const ahead = opts?.queuedAhead ?? 0;
      return ahead > 0 ? `Waiting — ${ahead} ahead` : 'Uploaded • Queued on server';
    }
    case 'running':
    case 'processing':
      return edit ? 'Updating meal...' : `Attempt ${job.attemptCount || 1} of ${job.maxAttempts || 3}`;
    case 'failed':
      return 'Analysis failed';
    case 'cancelled':
    case 'cancel_requested':
      return 'Analysis cancelled';
    case 'awaiting_user':
      return 'Action required';
    case 'succeeded':
      return 'Analysis completed';
    default:
      return 'Processing...';
  }
}
```

### E2. CREATE `src/jobs/__tests__/JobSession.contract.test.ts` (full file)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore } from '../JobStore';
import { previewStatus, previewStatusLabel } from '../jobPreview';
import { mergeFoodEditMessages } from '../mergeFoodEditMessages';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

const prior = {
  pendingFoodLog: {
    name: 'Meal',
    nutrients: { calories: 660 },
    itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }],
  },
};

const next = {
  pendingFoodLog: {
    name: 'Grilled Fish and Water Spinach Meal',
    nutrients: { calories: 650 },
    itemsBreakdown: [{ name: 'Unsweetened Iced Tea', nutrients: { calories: 0 } }],
  },
};

describe('JobSession contract (STALE_TURN)', () => {
  beforeEach(() => {
    JobStore.clearForTests();
  });

  it('edit submit shows Updating meal while the prior meal is still on the job', () => {
    JobStore.createJob({
      id: 'tea1',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });
    JobStore.updateJob('tea1', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      statusMessage: 'Updating meal...',
    });
    const job = JobStore.getJob('tea1')!;
    expect(previewStatus(job) === 'queued' || previewStatus(job) === 'running' || previewStatus(job) === 'processing').toBe(true);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(job.result?.pendingFoodLog?.nutrients?.calories).toBe(660);
  });

  it('same-meal succeeded echo does not complete the turn', () => {
    JobStore.createJob({
      id: 'tea2',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea2', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea2', {
      status: 'succeeded',
      result: prior,
      messages: [{ role: 'assistant', content: 'old' }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const job = JobStore.getJob('tea2')!;
    expect(job.inFlightTurnAt).toBeGreaterThan(0);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(previewStatus(job)).not.toBe('succeeded');
  });

  it('new Unsweetened snapshot completes to Analysis completed', () => {
    JobStore.createJob({
      id: 'tea3',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea3', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea3', {
      status: 'succeeded',
      result: next,
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const done = JobStore.getJob('tea3')!;
    expect(previewStatus(done)).toBe('succeeded');
    expect(previewStatusLabel(done)).toBe('Analysis completed');
    expect(done.result?.pendingFoodLog?.itemsBreakdown?.[0]?.name).toMatch(/Unsweetened/);
    expect(done.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
  });

  it('keeps one food card on merge', () => {
    const original = {
      id: 'a1',
      role: 'assistant',
      pendingFoodLog: prior.pendingFoodLog,
      data: { pendingFoodLog: prior.pendingFoodLog },
    };
    const user = { id: 'u2', role: 'user', content: 'the tea is unsweetened' };
    const assistant = {
      id: 'a2',
      role: 'assistant',
      content: 'Unsweetened Iced Tea is 0 kcal',
      pendingFoodLog: next.pendingFoodLog,
      data: { pendingFoodLog: next.pendingFoodLog, mode: 'modify' },
    };
    const merged = mergeFoodEditMessages([original, user], assistant);
    expect(merged.filter((m: any) => m.data?.pendingFoodLog || m.pendingFoodLog)).toHaveLength(1);
  });
});
```

### E3. FIND → REPLACE `src/components/TaskPlaceholderCard.tsx`

**FIND** (import block — insert after the JobStore import line):

```
import { JobStore } from '../jobs/JobStore';
```

**REPLACE:**

```
import { JobStore } from '../jobs/JobStore';
import { previewStatus, previewStatusLabel, isEditJob, isTurnInFlight } from '../jobs/jobPreview';
```

**FIND:**

```
  const turnInFlight =
    typeof job.inFlightTurnAt === 'number' &&
    (!job.finishedAt || new Date(job.finishedAt).getTime() < job.inFlightTurnAt);
  const effectiveStatus: AgentJob['status'] =
    turnInFlight && (job.status === 'succeeded' || job.status === 'awaiting_user')
      ? 'running'
      : job.status;
```

**REPLACE:**

```
  const turnInFlight = isTurnInFlight(job);
  const effectiveStatus: AgentJob['status'] = previewStatus(job);
```

**FIND:**

```
  const isEditMode =
    job.inputSnapshot?.mode === 'edit' ||
    (job as any).mode === 'edit' ||
    (job as any).mode === 'modify' ||
    (job.messages && job.messages.filter((m: any) => !m.isLive).length > 2);

  const getStatusLabel = () => {
    if (effectiveStatus === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
      return 'AI advice pending';
    }
    if (isFailedOrTimedOut) {
      return 'Analysis failed';
    }
    const statusKey = effectiveStatus as JobStatus;
    switch (statusKey) {
      case 'queued': {
        if (isEditMode) return 'Updating meal • Queued';
        const queue = JobStore.getAllJobs().filter(j => j.status === 'queued' || j.status === 'running');
        const myIndex = queue.findIndex(j => j.id === job.id);
        const ahead = myIndex > 0 ? myIndex : 0;
        return ahead > 0 ? `Waiting — ${ahead} ahead` : 'Uploaded • Queued on server';
      }
      case 'running':
      case 'processing':
        return isEditMode ? 'Updating meal...' : `Attempt ${job.attemptCount || 1} of ${job.maxAttempts || 3}`;
      case 'failed':
        return 'Analysis failed';
      case 'cancelled':
      case 'cancel_requested':
        return 'Analysis cancelled';
      case 'awaiting_user':
        return 'Action required';
      case 'succeeded':
        return 'Analysis completed';
      default:
        return 'Processing...';
    }
  };
```

**REPLACE:**

```
  const isEditMode = isEditJob(job);

  const getStatusLabel = () => {
    const queue = JobStore.getAllJobs().filter(j => j.status === 'queued' || j.status === 'running');
    const myIndex = queue.findIndex(j => j.id === job.id);
    const ahead = myIndex > 0 ? myIndex : 0;
    return previewStatusLabel(job, { queuedAhead: ahead, lastMsgContent });
  };
```

Keep `isFailedOrTimedOut` and `getStatusColorClass` using `effectiveStatus` as they already do.

### E4. Tick effect — FIND the `isActive` line that duplicates `inFlightTurnAt` and REPLACE with `isTurnInFlight(job)` if you already imported it. Optional if E3 compiled.

---

## F. Machine gate

```bash
npx tsc --noEmit
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/mergeFoodEditMessages.test.ts
node scripts/assert-f9-pr1.mjs
node scripts/assert-dev-serves-vite.mjs
```

All exit 0 required.

---

## G. STATUS

| ID | Done when | Evidence |
|----|-----------|----------|
| F9P1-1 | `jobPreview.ts` exports four helpers | file + assert-f9-pr1 |
| F9P1-2 | Contract test: Updating → echo ignored → Unsweetened completed | vitest named file |
| F9P1-3 | Card calls helper | import + `previewStatusLabel(` |
| F9P1-4 | Gates green; no food-calc files in the diff | git diff |

---

## H. Out of scope + order

Out: F-9.3 inspector, F-9.4 `current_turn`, F-9.5 reducer, F-8.10, dietitian, `npm run build`.

After COMPLETE: stop. Grok reviews. Next pack is `studio/F9_PR2_GEMINI.md`.
