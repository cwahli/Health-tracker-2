# Gemini — continue bug fixing (human notes)

**Do not paste this file into AI Studio.** The full instruction lives on **Hand off**.

**For you:** Open `#n` → click **Hand off** → paste the clipboard into Gemini. After that only say **continue**.

**Spec:** `plan/QUALITY.md` §14.4. One class per job. No `POST /loop`. Do not mark the card done from chat.

`GET /api/bugs/next` stays on the **in-progress card** while it has remaining (so continue does not jump to BMI).

---

## What you do

1. Click **Hand off** on the card. Paste only that. No pack, no §A.
2. After Studio returns: History should show a new attempt. Remaining shrinks only if `result=pass` and `line` matched.
3. Food-calc lines: **Re-analyze** before you believe the meal. Replay log/catalog is the frozen tape.
4. Say **continue**. `/next` stays on this card until remaining is empty or blocked.

If History is empty, Gemini did not POST `/attempts` — the card will look unchanged. Ask them to POST, do not say “try fixing #11”.

---

## C. Gate (if they touched `src/` or `server_*.ts`)

```bash
npx tsc --noEmit
npx vitest run src/utils/bugWorkItem.test.ts
```

Plus the named vitest they added for the class. Food catalog/resolver: `npx vitest run server_food_db.test.ts server_food_catalog.test.ts` when those files change.
