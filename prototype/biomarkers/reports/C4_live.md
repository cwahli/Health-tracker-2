# C4 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (4 known / 0 unknown)

## System instruction (verbatim)

```
You fill USER slots only.
HIT: dictionary locked. JSON: id, medicalInsight, customRangeOverlay (null unless this profile's range differs). Cite status. Optimal: 1 sentence. Else <=2 sentences (profile + trend). HbA1c 40 in 20-41 can still be Elevated. Never write Critical.
MISS: JSON: id, match "none", writeTarget "pending", key null, newCatalogDraft (suggestedKey, name, unit, aliases, normalRange, description, riskCategories). Not Home.
No status field. No unit math. This batch only. JSON { "rows": [...] }.

SPECIAL RULES FOR SCORING:
- For HbA1c (if custom range applies due to profile), customRangeOverlay MUST be a full bracketed range containing 39 or 42 and words like elevated/borderline/optimal/normal.
- For eGFR, if correcting optimal from naive 60 to >= 90, you MUST provide an editReason explaining correction of naive normal eGFR.
```

## User send (once)

```
I'm a 43 year old Chinese male, 178 cm, 78 kg. Here are my results: HbA1c 5.7, LDL 130, eGFR 80, ALT 41.
HbA1c  5.7 
LDL  130 
eGFR  80 mL/min/1.73m2
ALT  41 U/L
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | HbA1c | key | observation | hba1c |
| r02 | LDL | key | observation | ldl |
| r03 | eGFR | key | observation | egfr |
| r04 | ALT | key | observation | alt |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — r01, r02, r03, r04 (4 rows, 1940ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
I'm a 43 year old Chinese male, 178 cm, 78 kg. Here are my results: HbA1c 5.7, LDL 130, eGFR 80, ALT 41.
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "HbA1c",
      "value": 39,
      "unit": "mmol/mol",
      "date": "2026-06-05",
      "range": "20 - 41",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "20 - 41",
        "unit": "mmol/mol",
        "description": "Average blood glucose levels over the past 2-3 months."
      }
    },
    {
      "id": "r02",
      "name": "LDL-C",
      "value": 3.36,
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
    },
    {
      "id": "r03",
      "name": "eGFR",
      "value": 80,
      "unit": "mL/min/1.73m2",
      "date": "2026-06-05",
      "range": ">= 60 mL/min/1.73m2",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "over 90",
        "unit": "mL/min/1.73m²",
        "description": "Estimated Glomerular Filtration Rate, showing kidney health."
      }
    },
    {
      "id": "r04",
      "name": "ALT (SGPT)",
      "value": 41,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "10 - 40",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "10 - 40",
        "unit": "U/L",
        "description": "Alanine Aminotransferase, an enzyme found mostly in the liver."
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
    "medicalInsight": "Your HbA1c is 39 mmol/mol, which is within the normal range of 20 - 41 mmol/mol, representing healthy long-term blood glucose control.",
    "optimalValue": "< 38 mmol/mol",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 39,
        "unit": "mmol/mol",
        "comment": null
      }
    ],
    "customRangeOverlay": "[All patients] Elevated: 39 - 41; Optimal: < 39; Normal: 20 - 41"
  },
  {
    "id": "r02",
    "medicalInsight": "Your LDL-C is 3.36 mmol/L, which is elevated compared to the optimal threshold of <= 2.6 mmol/L.",
    "optimalValue": "<= 2.6 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 3.36,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null
  },
  {
    "id": "r03",
    "medicalInsight": "Your eGFR is 80 mL/min/1.73m2, which sits below the optimal adult target of >= 90 mL/min/1.73m2.",
    "optimalValue": ">= 90 mL/min/1.73m2",
    "editReason": "Correcting naive normal eGFR threshold to >= 90 mL/min/1.73m2 for optimal kidney health assessment.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 80,
        "unit": "mL/min/1.73m2",
        "comment": null
      }
    ],
    "customRangeOverlay": null
  },
  {
    "id": "r04",
    "medicalInsight": "Your ALT is 41 U/L, which is slightly above the standard normal upper limit of 40 U/L.",
    "optimalValue": "< 30 U/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 41,
        "unit": "U/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | HbA1c | key | observation | — | hba1c | — | — |
| r02 | LDL | key | observation | — | ldl | — | — |
| r03 | eGFR | key | observation | — | egfr | — | — |
| r04 | ALT | key | observation | — | alt | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
