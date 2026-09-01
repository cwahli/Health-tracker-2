# Q-6.4 Gemini — G2 tape actions (food `#n`)

**For:** Gemini 3.7 Flash High / AI Studio.  
**Spec:** `plan/QUALITY.md` §14.4 (read, do not edit).  
**Layout:** `studio/mockups/bug-queue-combined-flow.html` (review / iteration screens).  
**Inventory:** live `BugTrackerModal.tsx`, `GoldenInboxPanel.tsx`, `BugSnapshotFab.tsx`, `src/components/bugQueue/*`.

G1 UI and Grok contract work are **already in tree**. You are not starting the snap from scratch. You copy **Inbox tape actions** onto the bug card so Checks/Dishes/Scout/Balance are live, not empty shells.

---

## A. Paste this as the Gemini prompt (replaces G1)

```text
You are doing G2 for Health-tracker Q-6.4. Read studio/Q64_GEMINI_COMBINED_QUEUE_UI.md and execute G2 IDs only.

Already done (do not rebuild): one snap form, remaining rows + pin shot, auto-spot, snapSurface food|home|health|other, line_photos persist, NOW always visible, Home thin pack, tracker tabs, Golden Inbox option.

DO:
1. When a food #n is selected, POST /api/golden/preview using current_evidence.debug_url / scout_url / job_id (same body shape BugSnapshotFab already uses). Store the board on selectedTagDetail.board so FoodDetailTabs Checks/Dishes/Scout/Balance have data.
2. On food #n action bar (next to Triage / Hand off): Replay log (preview, no agent) and Replay catalog if you can do it WITHOUT creating a golden_cases row. Catalog must not PATCH remaining or queue=done. Do not POST /loop.
3. Green/red bar on food #n from board.outcomes (pass vs fail). Accept-class / Scouted only ≠ remaining. NOW remaining list stays the source of remaining.
4. Capture pack in BugSnapshotFab: food keeps nutrient+debug JSON; home hides those and keeps a11y+screenshot; health keeps history-ish, hides food debug.
5. Re-analyze / NEW Analyze on food #n only if an existing job_id path already exists. Do not invent a new analyze pipeline.

DO NOT:
- Edit snapSurface, jobFitsSnap, resolveDomainPack, applySnapRemaining, classifyJobResult, writeInboxCase
- Change remaining off string[] or invent remaining: Array<{
- Hide Golden Inbox, Promote official G*, expand Make Golden → tests/Golden_meal/inbox/
- Mint D1 golden_cases rows so you can call /api/golden/cases/:id/replay
- POST /api/golden/cases/:id/loop
- expected.json, food_aliases, server_food_db, dietitian prompts, AGENTS.md, docs/agent/**, plan/QUALITY.md
- Product bugs #2 #3 #9 #10
- Mark Q-6.4 done

Anti-drop: Take picture AND Add image AND paste; Scout identity; Add Dish; NOW; Hand off; value="golden"; Make Golden may stay until Grok Promote.
Gate: pack §F.
Honest residual if catalog replay needs a new server route: skip catalog, ship Replay log + board load.
```

---

## B. Honesty / anti-miss

- **Mock ≠ inventory.** Inbox still has Replay log, Replay catalog, NEW Analyze, Pipeline, Promote, Copy job. Tracker must **gain** Replay log (and catalog if possible). Do not delete Inbox to “combine.”
- **Preview does not write queue status.** `POST /api/golden/preview` returns a board. Do not PATCH `/api/bugs/:id` with `all_green` or `remaining: []` because the board looks green.
- **Do not mint D1.** `/api/golden/cases/:id/replay` is the Inbox (D1) path. Bug cards are `issue_tags`. Use **preview** (and artifacts) for `#n`.
- Last G1 misses Grok had to fix: empty `autoSpotHome({})`, NOW hidden behind tab, remaining not POSTed. This time **mount** the board and buttons. Unmounted helpers = FAIL.

---

## C. Already DONE — do not rebuild

| Piece | Where |
|-------|--------|
| One snap, Add bug, pin shot, auto-spot | `BugSnapshotFab` + `bugQueue/` |
| `snapSurface` food/home/health/other | `bugDomainPacks.ts` — **do not edit** |
| Home = no job, thin bmi/weight/height | `resolveDomainPack` |
| Remaining persist + `line_photos` | `applySnapRemaining` / snap POST `remaining_lines` |
| NOW always on + selected-line hand off | `BugTrackerModal` |
| Tabs Checks/Dishes/Scout/Balance/History | `FoodDetailTabs.tsx` (often empty — you load `board`) |
| Auto-spot helper | `bugAutoSpot.ts` |
| `/loop` 410 | leave it |

`Make Golden` → `POST /api/bugs/:id/make-golden` still writes `tests/Golden_meal/inbox/`. **Leave the button.** Grok will replace it with official Promote. Do not hide Inbox.

---

## D. How Replay log works on a bug card

`GET /api/bugs/:id` → `now.current_evidence` (`debug_url`, `scout_url`, `job_id`, `photo_urls`, `line_photos`).

Replay log (no agent):

```text
POST /api/golden/preview
body: {
  backendLogsUrl or debugUrl: evidence.debug_url || evidence.scout_url,
  jobId: evidence.job_id,
  jobStatus: optional
}
```

Same shape as `BugSnapshotFab` preview fetch (~line 459). Put `board` on `selectedTagDetail`. Re-render `FoodDetailTabs`.

Replay catalog: **only** if you can run dictionary lookup without a `golden_cases` id (e.g. scout JSON already on the tag payload). If not, residual: `Catalog replay skipped — needs Grok route, no D1 mint`.

Re-analyze: Inbox `NEW Analyze` uses saved photos + query on a **case id**. On `#n`, if `job_id` exists, opening that food job is enough **only** if that open-job helper already exists in the app. Do not POST pipeline replay that calls Gemini from the tracker unless you copy an existing function.

---

## E. Capture pack slots (snap)

In `BugSnapshotFab` capture checkboxes, branch on `snapSurface(category, activeTab)` (import already possible). Meal modal open → food.

| Surface | Show | Hide |
|---------|------|------|
| food | a11y, overview, photo, nutrient, debug JSON | full biomarker history |
| home | a11y, screenshot/photo, session | nutrient calculation, food debug JSON |
| health | a11y, photo, session (history is the HealthLogs panel) | food nutrient/debug |
| other | a11y, photo, session | food + bio packs |

Do not stop sending a11y.

---

## F. Machine gate

```bash
npx tsc --noEmit
npx vitest run src/utils/bugDomainPacks.test.ts src/utils/bugWorkItem.test.ts src/utils/bugAutoSpot.food.test.ts src/utils/bugAutoSpot.home.test.ts src/utils/bugAutoSpot.health.test.ts src/components/bugQueue/__tests__/bugQueueComponents.test.tsx
```

Add a vitest that: FoodDetailTabs with a preview-shaped `board` (journey + invariants with `pass: true`) still renders; a helper that maps outcomes → bar percents treats `pass: true` as green and does not treat a label “Scouted only” as remaining.

Grep still hit:

```bash
grep -n "Take picture" src/components/BugSnapshotFab.tsx
grep -n "Add image" src/components/BugSnapshotFab.tsx
grep -n "addEventListener('paste'" src/components/BugSnapshotFab.tsx
grep -n "Scout identity" src/components/BugSnapshotFab.tsx
grep -n "Hand off" src/components/BugTrackerModal.tsx
grep -n 'value="golden"' src/components/BugTrackerModal.tsx
grep -n "NOW" src/components/BugTrackerModal.tsx
```

Diff must **not** include: `snapSurface(`, `jobFitsSnap`, `writeInboxCase`, `remaining: Array<{`, `/loop`.

`git diff src/utils/bugDomainPacks.ts src/utils/bugWorkItem.ts` should be **empty**.

---

## G. STATUS (6 IDs)

| ID | Work | Done when |
|----|------|-----------|
| G2-1 | Load preview board onto food `#n` | `FoodDetailTabs` shows journey/invariants from evidence URLs, not only empty copy |
| G2-2 | Replay log button on food `#n` | Calls preview; does not PATCH remaining/done |
| G2-3 | Green/red bar | From board outcomes; remaining list unchanged |
| G2-4 | Capture pack slots | Food vs home vs health checkboxes as table E |
| G2-5 | Replay catalog / Re-analyze | Mounted **or** explicit residual (no D1 mint) |
| G2-6 | Anti-drop + gates | §F grep + tsc + named vitest exit 0 |

---

## H. Grok only — blocked

| Item | Why |
|------|-----|
| 5 Promote official G* / hide Inbox / replace Make Golden | Fail-safe git goldens; photos required; `mayPromote` |
| 6 D1 migrate / stop `writeInboxCase` | Data; do not create more Inbox rows |
| `snapSurface` / `jobFitsSnap` / Home glue | Already split; do not touch |
| `#2` `#3` `#9` `#10` | L14 class-first |

**Do not build:** `/loop`, `all_green` as COMPLETE, catalog writing queue status, a sixth `plan/` file.

---

## Residual (required wrap-up)

```text
G2: <IDs shipped>
Board source: preview from <debug_url|scout_url|job_id|none>
Catalog replay: mounted / skipped because <reason>
Did not touch: snapSurface, remaining JSON, Promote, Inbox, D1, writeInboxCase
Anti-drop grep: pass / fail
Q-6.4: not done — Grok items 5–6 remain
```
