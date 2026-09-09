# C7 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (2 known / 0 unknown)

## System instruction (verbatim)

```
You fill USER slots only.
HIT: dictionary locked. JSON: id, medicalInsight, customRangeOverlay (null unless this profile's range differs). Cite status. Optimal: 1 sentence. Else <=2 sentences (profile + trend). HbA1c 40 in 20-41 can still be Elevated. Never write Critical.
MISS: JSON: id, match "none", writeTarget "pending", key null, newCatalogDraft (suggestedKey, name, unit, aliases, normalRange, description, riskCategories). Not Home.
No status field. No unit math. This batch only. JSON { "rows": [...] }.

SPECIAL RULES FOR SCORING:
- For HbA1c (if custom range applies due to profile), customRangeOverlay MUST be a full bracketed range containing 39 or 42 and words like elevated/borderline/optimal/normal.
- For eGFR, if correcting optimal from naive 60 to >= 90, you MUST provide an editReason explaining correction of naive normal eGFR.
- DICTIONARY CORRECTION: If dictionary info has typos/errors (e.g. Total Protein 6-8 g/L instead of 60-80 g/L), output dictionaryCorrection: { field, correctedValue, reason }. Otherwise null.
```

## User send (once)

```
BUN is 15 mg/dL. LDL is 100 mg/dL. Oh and here's my SSN and address: 123 Main St, SSN: 123-45-6789.
BUN  15 mg/dL
LDL  100 mg/dL
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | BUN | key | observation | bun |
| r02 | LDL | key | observation | ldl |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — r01, r02 (2 rows, 1547ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
BUN is 15 mg/dL. LDL is 100 mg/dL. Oh and here's my SSN and address: 123 Main St, SSN: 123-45-6789.
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "BUN (Blood Urea Nitrogen)",
      "value": 5.35,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "7 - 20",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "7 - 20",
        "unit": "mg/dL",
        "description": "Urea nitrogen levels; high levels can show kidney load."
      }
    },
    {
      "id": "r02",
      "name": "LDL-C",
      "value": 2.59,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "[All patients] Very High: >3.4; Elevated: >2.6; Optimal: <=2.6",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 2.6",
        "unit": "mmol/L",
        "description": "Low-Density Lipoprotein, the \"bad\" cholesterol driving plaque."
      }
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "r01",
    "medicalInsight": "Your BUN level of 15 mg/dL is optimal and well within the normal range, indicating healthy kidney function.",
    "optimalValue": "7 - 20 mg/dL",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 15,
        "unit": "mg/dL",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r02",
    "medicalInsight": "Your LDL level of 100 mg/dL (2.59 mmol/L) is optimal and demonstrates good cardiovascular risk management.",
    "optimalValue": "< 2.6 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.59,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | BUN | key | observation | — | bun | — | — |
| r02 | LDL | key | observation | — | ldl | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
