# Output templates (SPEC · SELF-CHECK · GATE)

Paste GATE / SELF-CHECK before declaring COMPLETE on **L/X** **code** work.  
Skip the spec entirely for questions, prototype reviews, and Class S.  
Do not invent a free-form STATUS that skips gates. Do not `npm test`.

**L/X IMPACT is a file, not a chat paste.** Specify writes `specs/active/<ID>.md` (`status: draft`). Human locks it. Implementer does not edit it. Full process + worked example: `LOCKED_SPEC_PROCESS.md`. Template: `specs/TEMPLATE.md`.

---

## IMPACT (before coding L/X)

Do **not** paste the old IMPACT block into chat — it dies with the session.

1. Specify (read-only except the spec file) copies `specs/TEMPLATE.md` → `specs/active/<ID>.md`, `status: draft`.
2. Human sets `status: locked` (or says “lock &lt;ID&gt;”).
3. Implement patches **only** `allowed_files`. `frozen_files` stay empty-diff.
4. COMPLETE includes `node scripts/assert-spec-diff.mjs <ID>` exit 0.

If the debug file already has the new numbers and the card does not: **class `STALE_TURN`**, **layer job-session** — that ID’s spec must name job-lifecycle files **and** `JobSession.contract.test.ts` in `gate`. Do not touch those files from a food-calc spec.

If Specify’s Allowed list is larger than the user asked: **stop and report** — do not silently expand.

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
assert:  exit ?   (list exact scripts, including node scripts/assert-spec-diff.mjs <ID>)
notes:   <sibling paths verified / known-broken link>
```

Copy real exit codes. “Tests passed” without names = FAIL.

---

## Minimal COMPLETE block

```text
COMPLETE
spec: specs/active/<ID>.md (locked, unchanged)
SELF-CHECK: all boxes
GATE LOG: all exit 0
paths: <verified list>
```

Forbidden phrases until true: all done · fully verified · nothing left · all requirements completed.
