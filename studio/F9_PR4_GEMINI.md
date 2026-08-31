# F-9 PR4 Gemini — JobStore.apply (not App.tsx / LogChat.tsx)

**For:** Gemini / AI Studio.  
**Depends:** F-9 PR3 (`currentTurn` exists).  
**Who:** You convert JobStore + SupabaseJobSync + JobQueueRunner to `apply(event)`. **Do not edit `App.tsx` or `LogChat.tsx`.** Grok does those emitters after you merge.

---

## A. Paste this as the Gemini prompt

```text
You are doing F-9 PR4 for Health-tracker. Read studio/F9_PR4_GEMINI.md.

Add JobStore.apply(event) as the mutator. Keep updateJob as a thin wrapper that builds a ServerStatus/PollerPayload-style patch for one release so existing call sites compile.

Convert src/jobs/SupabaseJobSync.ts and src/jobs/JobQueueRunner.ts to call apply() instead of updateJob where they set status/result.

DO NOT edit App.tsx or LogChat.tsx (Grok). DO NOT rewrite JobStore load/save/delete. DO NOT food-calc. DO NOT npm run build.

Gate: pack §F. JobSession.contract.test.ts must pass.
```

---

## B. Honesty

`updateJob` may remain as a wrapper. UI grep-clean is Grok’s follow-up. If you touch App.tsx, FAIL this pack.

---

## C. Already DONE

PR1–PR3. `mergeFoodEditMessages` stays the only chat merge helper — call it from apply on AnalyzeFinished / PollerPayload when `shouldMergeFoodEditTurn`.

---

## D. Event types (do not invent more)

```ts
export type JobEvent =
  | { type: 'SubmitStarted'; id: string; mode?: string; inputSnapshot?: any; messages?: any[]; statusMessage?: string; currentTurn?: number; clientSubmitPending?: boolean }
  | { type: 'ServerStatus'; id: string; status: AgentJob['status']; statusMessage?: string }
  | { type: 'PollerPayload'; id: string; status: AgentJob['status']; result?: any; messages?: any[]; currentTurn?: number; updatedAt?: string }
  | { type: 'RealtimeRow'; id: string; status: AgentJob['status']; result?: any; currentTurn?: number; updatedAt?: string; statusMessage?: string; progressPercent?: number }
  | { type: 'AnalyzeFinished'; id: string; result?: any; messages?: any[]; currentTurn?: number }
  | { type: 'AnalyzeFailed'; id: string; error: AgentJob['error'] };
```

Put types in `src/jobs/types.ts` or `src/jobs/jobEvents.ts` (prefer new small file).

`apply` must:

1. `recordSessionEvent` with writer matching the event (poller / realtime / JobStore.apply / JobQueueRunner).
2. Drop `currentTurn < job.currentTurn` (reuse PR3 guard).
3. Reuse existing same-meal / inFlightTurnAt guards until those flags are gone.
4. Notify + saveJobs as today.

---

## E. FIND / files

| File | Change |
|------|--------|
| `src/jobs/jobEvents.ts` | CREATE (types + maybe a small `toPatch` helper) |
| `src/jobs/JobStore.ts` | add `apply`; `updateJob` calls `apply` or shares private `commit(id, patch)` |
| `src/jobs/SupabaseJobSync.ts` | `processJobRows` / realtime → `JobStore.apply({ type: 'RealtimeRow', ... })` |
| `src/jobs/JobQueueRunner.ts` | status writes → `apply({ type: 'ServerStatus', ... })` |

Do not change deleteJob, createJob, localStorage, ImageStore.

---

## F. Gate

```bash
npx tsc --noEmit
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobQueueRunner.test.ts
```

Plus: `rg "JobStore.updateJob" src/jobs/SupabaseJobSync.ts src/jobs/JobQueueRunner.ts` should be 0 (or only comments). `rg` in App.tsx / LogChat.tsx **must still find updateJob** (Grok leftover). If you removed those, you went out of scope — revert.

---

## G. STATUS

| ID | Done when |
|----|-----------|
| F9P4-1 | JobEvent types file |
| F9P4-2 | JobStore.apply |
| F9P4-3 | SupabaseJobSync uses apply |
| F9P4-4 | JobQueueRunner uses apply |
| F9P4-5 | App.tsx and LogChat.tsx **untouched** |

---

## H. Out of scope

App.tsx poller emitter, LogChat submit `SubmitStarted`. Grok does that after this pack. Do not “finish” F-9.5 by rewriting god files.
