# Meal 01 — Instruction (what the user does)

Log one session with these 5 photos, no text prompt:

1. `photo_01.jpg`
2. `photo_02.jpg`
3. `photo_03.jpg`
4. `photo_04.jpg`
5. `photo_05.jpg`

(All photos ≤200 KB, 1205×1600. Filenames carry no content hints by design.)

## Multi-turn flow (portion clarify → agent edit)

Turn 1 ends with portion questions on 2 packaged items (estimated single
serving ≠ pack size). Answer in context:

- The question for the item in `photo_01.jpg` → **130 g** (overwrites the 805 g pack default → agent edit)
- The question for the item in `photo_05.jpg` → **30 g** (= pack default → accepted, no agent needed for it)

Unanswered items stand at pack weight. The oats overwrite exceeds 30 %, so it resolves as an **agent verdict/advice patch turn** (`t2/scout` parented to `t1/scout`): TS applies the locks and rescales, the agent only refreshes verdict/advice and lists corrected dishes (full object + image coordinates) in `dishUpdates` — never regenerates dishes.
Post-edit ledger = `expected.json` dishes/totals. Turn-1 estimates and the
clarify spec live in `turn1Ledger` / `portionClarify` / `editTurn`.

Turn 3 (same job, no new photos): user removes the Apem pancake (not eaten)
and re-identifies the soup as soto santan — agent patch with 2 full
dishUpdates + coordinates, ledger in `expected.json` turn3.

`expected.json` is the answer key: 5 dishes with weights, full nutrient
vectors in `NUTRIENT_KEYS` order, meal totals, and `lockedLabelTruth` blocks
for packaged items. Rules for the pipeline under test:

- Printed kcal wins over Atwater where a label exists (F-8.12 brand/printed lock).
- Estimated dishes must land within ±20 % kcal of the benchmark vector and
  must not invent label-locked micros (high-dose vitamin C / zinc belong to
  exactly one dish — BIND_MISS, never hallucinate).
- Salt derives from sodium (`Na * 0.00254`); unsaturated fat = total − sat − trans.
