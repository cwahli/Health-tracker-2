# Output templates (IMPACT · SELF-CHECK · GATE)

Paste these before declaring COMPLETE on **L/X** **code** work.  
Skip IMPACT entirely for questions, prototype reviews, and doc-only edits.  
Do not invent a free-form STATUS that skips gates. Do not `npm test`.

---

## IMPACT (before coding L/X)

```text
IMPACT
class: S | M | L | X
layer: food-calc | job-session | ui-paint | serve-mode | other
goal: <one sentence>
files: [list that will change]
paths: [e.g. Mode A | Mode D | Edit | agent1…agent5 | food sync | bio sync | N/A + reason]
fields/contracts: [keys or tombstones that must remain]
domain docs read: [food-calc | biomarkers | sync | none]
out of scope: [explicit]
risk if wrong: <one sentence>
plan:
  - …
  - …
  - …
```

If the debug file already has the new numbers and the card does not: **class `STALE_TURN`**, **layer job-session**. Prove Vite vs `dist/` (`index.html` → `/src/main.tsx` vs hashed `/assets/index-*.js`) before patching. Do not touch job-lifecycle files from a food-calc IMPACT unless those files are listed **and** `JobSession.contract.test.ts` is in the same commit.

If IMPACT reveals larger scope than the user asked: **stop and report** — do not silently expand.

---

## SELF-CHECK (before claiming ready for gates)

```text
SELF-CHECK
- [ ] Every new import has a correct-path call site
- [ ] No placeholders / stubs left
- [ ] No drive-by refactors outside IMPACT.files
- [ ] No dropped fields on merge/construct (or listed in scope)
- [ ] Sibling paths: all updated OR known-broken noted
- [ ] Detect+repair present if detection was in scope
- [ ] Domain invariants from rulebook respected
- [ ] No gate script weakened to force pass
```

Self-check allows submission to gates. It does **not** allow COMPLETE.

---

## GATE LOG (required for COMPLETE)

```text
GATE LOG
tsc:     exit ?   (npx tsc --noEmit)
vitest:  exit ?   (list exact files/patterns)
assert:  exit ?   (list exact scripts)
notes:   <sibling paths verified / known-broken link>
```

Copy real exit codes. “Tests passed” without names = FAIL.

---

## Minimal COMPLETE block

```text
COMPLETE
IMPACT: <filled>
SELF-CHECK: all boxes
GATE LOG: all exit 0
paths: <verified list>
```

Forbidden phrases until true: all done · fully verified · nothing left · all requirements completed.
