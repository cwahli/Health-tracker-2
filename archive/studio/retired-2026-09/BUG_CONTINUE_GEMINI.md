# Continue bugs — human notes

Law is **`AGENTS.md` L15**. Do not paste this file.

- **Studio / Antigravity / Grok:** **work bug** (current) · **next bug** (next card) · **work 11** (that #). One phrase drains **all remaining on that card**.
- **GitHub-only (Claude):** paste **Hand off**.

**Spec:** `plan/QUALITY.md` §14.4. One class per remaining line. No `POST /loop`. Do not mark the card done from chat.

`GET /api/bugs/next` stays on the **in-progress card** while it has remaining (so it does not jump to BMI). After each `POST /attempts`, `continue.keep_going=true` means immediately work the next line — do not wait for the human.

---

## What you do

1. Say **work bug**, **next bug**, or **work 11** **once**.
2. Claude (GitHub only): **Hand off** paste. No extra pack.
3. Do **not** type continue between lines. Agent summarizes only when remaining is empty (`continue.stop=true`).
4. History must show an attempt per line. Remaining shrinks only if `result=pass` and `line` matched (or the line is parked after 2 misses).
5. Food-calc: **Re-analyze** before you believe the meal.

If History is empty, they skipped `POST /attempts`. Ask them to POST. Do not say “fix #11”.

---

## C. Gate (if they touched `src/` or `server_*.ts`)

```bash
npx tsc --noEmit
npx vitest run src/utils/bugWorkItem.test.ts
```

Plus the named vitest they added for the class. Food catalog/resolver: `npx vitest run server_food_db.test.ts server_food_catalog.test.ts` when those files change.
