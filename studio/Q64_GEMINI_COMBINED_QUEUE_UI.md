# Q-6.4 Gemini — combined queue bulk UI (G1)

**For:** Gemini 3.7 Flash High / AI Studio.  
**Spec:** `plan/QUALITY.md` §14.4 (read, do not edit).  
**Layout:** `studio/mockups/bug-queue-combined-flow.html` + `bug-queue-combined.html` + `studio/mockups/bug10/`.  
**Inventory:** live `BugSnapshotFab.tsx`, `BugTrackerModal.tsx`, `GoldenInboxPanel.tsx`. Mock is looks. Live is the checklist.

You **are** expected to edit the two large UI files and **mount** the new work. Last tracker/snap pass you already did this. Grok will finish schema, Promote, D1, and `snapSurface` home vs health — not the bulk layout.

Grok item 8 is already in tree: `src/utils/bugAutoSpot.ts`, `buildScoreboard().autoSpot`.

---

## A. Paste this as the Gemini prompt (replaces G0)

```text
You are implementing the BULK UI for Health-tracker Q-6.4 combined bug queue.
Read studio/Q64_GEMINI_COMBINED_QUEUE_UI.md and execute G1 IDs (not G0 shells).

Layout: studio/mockups/bug-queue-combined-flow.html (snap → review → iteration, use case #10)
         studio/mockups/bug-queue-combined.html (queue shell)
Inventory: BugSnapshotFab.tsx, BugTrackerModal.tsx, GoldenInboxPanel.tsx
Mock = looks. Live = every control that must still exist. Consolidate ≠ delete.

DO:
1. Snap: one form. Move Bug Report + Golden Meal controls onto it (do not delete scout identity, top dishes, capture pack). + Add bug, film select, Pin shot to selected bug. Remaining = checklist rows (text + optional photo + comment) in React state.
2. Under What’s wrong: AutoSpotList from previewBoard.autoSpot / autoSpotForSurface. Uncheck to drop. Parked = unchecked. Never “Scouted only”.
3. Pack show/hide from existing category + activeTab (food vs home vs health vs other). Do NOT change snapSurface() or jobFitsSnap().
4. Tracker #n: add tabs Checks · Dishes · Scout identity · Balance · History by copying panels from GoldenInboxPanel. Do not hide the Golden Inbox option. Do not add Promote-to-G*.
5. Hand off copy includes the selected remaining LINE (text + its photo URLs + comment), not only the whole film strip. Same existing copy/POST. Do not invent a new API.
6. Keep Take picture AND Add image AND paste. Anti-drop grep in pack §F.

DO NOT:
- Change BugWorkItem.remaining off string[] (view state may be richer; persist text lines)
- Add remaining: Array<{ to bugWorkItem / issue_tags / current_evidence
- Edit snapSurface, jobFitsSnap, classifyJobResult, writeInboxCase, resolveDomainPack attach rules
- Hide Inbox, Promote official G*, D1 migrate
- POST /api/golden/cases/:id/loop
- expected.json, food_aliases, server_food_db, dietitian prompts, AGENTS.md, docs/agent/**, plan/QUALITY.md
- Mark Q-6.4 done. Product bugs #2 #3 #9 #10 are out of scope.

If a persistence field does not exist, keep it in React state and list it under Residual. Do not fake a schema.
Gate: pack §F must exit 0.
```

---

## B. Honesty / anti-miss

- **You may edit** `BugSnapshotFab.tsx` and `BugTrackerModal.tsx`. Prefer extract-to-`src/components/bugQueue/` then thin call sites. Do not delete a live control because the mock forgot it.
- **Take picture + Add image + paste** must remain in `BugSnapshotFab` after your turn (the mock only draws shutter).
- Scout identity (full journey, not reds-only) and top dishes + Add dish stay on the **food** snap.
- Capture pack stays, default 6/6, collapsed.
- Golden Inbox tab stays until Grok Promote. Copy its panels into the tracker; do not delete the panel file.
- Import without a mounted call site = FAIL. Unmounted shells are not G1.
- Do not claim Q-6.4 complete.

**Last-time redo (do not repeat):**

| Miss | Rule this time |
|------|----------------|
| Job picker used array-end | Do not touch `pickSnapshotJob` / `resolveDomainPack` |
| Home snap glued leftover `food_job` | Do not attach food debug on Home. Branch UI on `activeTab`/`category` only |
| Mock omitted Add image | Keep file picker + paste even if mock has no button |

---

## C. Already DONE — do not rebuild

| Piece | Where |
|-------|--------|
| Queue, `/next`, work item | `bugWorkItem.ts`, tracker |
| Take picture, Add image, paste, Open `#n` vs new | `BugSnapshotFab.tsx` |
| Inbox tape (scout, dishes, Replay log, Balance) | `GoldenInboxPanel.tsx` |
| Auto-spot detectors | `bugAutoSpot.ts` — **call**, do not rewrite |
| `buildScoreboard().autoSpot` | suggestions only |
| `/loop` 410 | leave it |

`BugWorkItem.remaining` stays `string[]`. Per-line photo keys are **not** on `current_evidence` yet. Session state is enough for G1.

---

## D. Path matrix (UI only — do not change `snapSurface`)

Use **existing** `category` + `activeTab`. Overlay: meal modal open → food pack (`isAnyMealModalOpen` already forces `foodcart`).

| UI pack | When | Show | Hide |
|---------|------|------|------|
| food | `category==='foodcart'` or `activeTab==='food'` or meal modal | Scout, dishes, Replay, food auto-spot | Biomarker history, BMI dump |
| home | `activeTab==='home'` or `category==='home'` | Screenshot, thin tiles, tombstones for those keys | Food job, scout |
| health | medical / insights / trends / dictionary | History + keys | Food job, scout, Replay catalog |
| other | settings / database / unmatched | Screenshot + a11y | Food + bio packs |

`snapSurface()` still returns `'food' \| 'biomarker' \| 'other'`. **Do not change its signature.** Home vs health is a **render branch**, not a new enum. Grok will split the enum later.

Auto-spot: `autoSpotForSurface('food'|'home'|'health'|'other', …)` from `bugAutoSpot.ts`. Map home/health yourself from `activeTab`. Do not call food detectors on Home.

---

## E. Build (G1)

New folder `src/components/bugQueue/`. Then mount.

### E1. Remaining rows + pin shot (snap)

- Replace the single What’s-wrong textarea with a list of rows + **+ Add bug**.
- Film strip: click shot (blue ring), click row (blue border), **Pin selected shot to selected bug**. Same shot may pin to two rows.
- Each row: checkbox, text, comment, pinned thumbnails, optional class chip.
- On save/hand-off to existing bug APIs: `remaining` POST is still `string[]` of **text** (and you may append ` — ${comment}` if comment non-empty). Photos stay on the **card-level** `photo_urls` array already used by snap. Per-row pins live in component state until Grok item 2.

Props for `RemainingBugRow` — keep this shape (view only):

```ts
{
  id: string;
  text: string;
  checked: boolean;
  photos: string[];
  comment: string;
  source: 'user' | 'auto';
  classLabel?: string;
  parked?: boolean;
  selected?: boolean;
}
```

### E2. Auto-spot (snap)

Under the user rows: **Also spotted on tape — uncheck to drop**.

- Food: `previewBoard.autoSpot` if present, else `autoSpotFood({ foodLog, scout, logText, journey })`.
- Home/health: `autoSpotHome` / `autoSpotHealth` with data already on the snap pack. If that data is missing, skip hits (residual), do not fetch a new history dump on food.
- Parked (`hit.parked`, ledger SILENT_REPAIR) render unchecked.
- Filter `/scouted only/i`.

### E3. One snap form

Drop **tabs** Bug Report vs Golden Meal. **Move** every control that lived in those tabs onto the one form (title, Open `#n`, scout identity, top dishes, capture pack, golden meal name chip from the job). Do not leave a control only in dead code.

### E4. Tracker `#n` tabs

For a **food** card, add tab strip: Checks · Dishes · Scout identity · Balance · History.

- Copy behavior from `GoldenInboxPanel` (Replay log, catalog does not flip remaining, ledger `mayPromote` warning may show as text).
- **Do not** wire Promote-to-G* / Make Golden.
- **Do not** remove `<option value="golden">` Inbox.
- History tab already exists — keep commits, lightbox, burns, NOW, remaining Done.
- Home/health cards: no Replay catalog, no dish table. Show HomeState / HealthLogs placeholders or existing biomarker pack.

### E5. Hand off

Existing Hand off button: clipboard/text must include:

```text
Active line: <text>
Photo: <urls or none>
Comment: <comment or none>
Remaining: <all remaining texts>
```

Use `POST /api/bugs/:id/attempts` only if that call already exists for hand off. No new endpoint.

---

## F. Machine gate

```bash
npx tsc --noEmit
npx vitest run src/utils/bugAutoSpot.food.test.ts src/utils/bugAutoSpot.home.test.ts src/utils/bugAutoSpot.health.test.ts src/utils/goldenScoreboard.test.ts src/utils/bugDomainPacks.test.ts src/utils/bugSnapshot.test.ts
```

Add `src/components/bugQueue/*.test.tsx` (or `.test.ts`) covering: RemainingBugRow renders; AutoSpotList hides “Scouted only”; FoodTapePanel hidden when `surface` prop is `home`.

Grep **must still hit** in `BugSnapshotFab.tsx`:

```bash
rg -n "Take picture" src/components/BugSnapshotFab.tsx
rg -n "Add image" src/components/BugSnapshotFab.tsx
rg -n "addEventListener\\('paste'" src/components/BugSnapshotFab.tsx
rg -n "Scout identity" src/components/BugSnapshotFab.tsx
rg -n "Add [Dd]ish" src/components/BugSnapshotFab.tsx
```

Grep **must still hit** in tracker:

```bash
rg -n "Hand off" src/components/BugTrackerModal.tsx
rg -n "Next bug" src/components/BugTrackerModal.tsx
rg -n "value=\"golden\"" src/components/BugTrackerModal.tsx
```

Diff must **not** include: `writeInboxCase` edits, `jobFitsSnap` edits, `snapSurface` signature change, `POST /loop`, `remaining: Array<{`, `all_green` as done.

`git diff src/utils/bugDomainPacks.ts` should be **empty**. If you needed a UI helper, put it in `bugQueue/`, not in domain packs.

---

## G. STATUS (6 IDs)

| ID | Work | Done when |
|----|------|-----------|
| G1-1 | One snap form + Add bug + pin shot + remaining rows | Mounted in `BugSnapshotFab`; textarea not the only What’s-wrong |
| G1-2 | Auto-spot list | Real `AutoSpotHit[]`; parked unchecked; no Scouted only |
| G1-3 | Pack show/hide | Food tape off on Home; no bio dump on food; `snapSurface` untouched |
| G1-4 | Tracker tabs | Checks/Dishes/Scout/Balance/History on food `#n`; Inbox option remains |
| G1-5 | Hand off active line | Copied text includes selected line + its photos/comment |
| G1-6 | Anti-drop + gates | §F grep + tsc + named vitest exit 0 |

---

## H. Grok finish (do not start)

| Item | Why |
|------|-----|
| 2 Per-line photo keys on `current_evidence` | Schema / R2 |
| `snapSurface` `'home' \| 'health'` + `jobFitsSnap` | Last glue bug; Grok |
| 5 Promote → official G* / hide Inbox | Fail-safe goldens |
| 6 D1 migrate / stop `writeInboxCase` | Data |
| 7 Snap/promote tests beyond §F | After 2 and 5 |
| `#2` `#3` `#9` `#10` product fixes | L14 |

**Do not build:** `/loop`, `all_green` as COMPLETE, catalog writing queue status, a sixth `plan/` file.

---

## Residual (required wrap-up)

```text
G1: <IDs shipped>
React-only (not persisted): <per-line photos / comments>
Did not touch: snapSurface, jobFitsSnap, remaining JSON, Promote, Inbox, D1
Anti-drop grep: pass / fail
Q-6.4: not done — Grok items 2,5,6 remain
```
