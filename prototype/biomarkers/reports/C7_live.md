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
You are an expert clinical laboratory AI reviewing a patient's biomarker panel.
Patient Profile: 43-year-old Chinese male, Unit Preference: SI.

For each biomarker:
- id: matching id
- medicalInsight: Provide a concise, clinically accurate insight for every row (including optimal/normal baseline markers). Cite trend if previous values exist. Consider patient ethnography (e.g. for Chinese patients, HbA1c >=39 indicates elevated prediabetes risk).
- customRangeOverlay: If agreeing with range, return "". If missing ethnic thresholds (e.g. HbA1c for Chinese patients), provide FULL multi-bracket range: "Elevated (Diabetes): >=48; Elevated: >=39; Normal: >=20".
- optimalValue: If existing is accurate, return "". Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it).
- editReason: If replacing/correcting existing user values or suboptimal optimalValue, explain why. Otherwise "".
- logs: Extract all logs with standardized "YYYY-MM-DD" dates, labName if mentioned (e.g. "US lab", "GP Clinic"), and comments. Convert US units to patient's unitPreference with standard clinical integer rounding (e.g. 1.1 mg/dL creatinine → 97 umol/L, not decimals like 97.24). Standardize scientific units (e.g. 10^9/L).
- DICTIONARY CORRECTION: If dictionary info has typos/errors (e.g. Total Protein 6-8 g/L instead of 60-80 g/L), output dictionaryCorrection: { field, correctedValue, reason }. Otherwise null.
- UNCATALOGED (MISS): If not in dictionary, output match="none", writeTarget="pending", key=null, and newCatalogDraft: { suggestedKey, name, unit, aliases, normalRange, description, riskCategories }.

JSON { "rows": [...] }.
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

### Turn 1 (hit) — r01, r02 (2 rows, 1736ms)

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
    "medicalInsight": "BUN is within normal limits at 5 mmol/L (converted from 15 mg/dL), indicating normal renal urea clearance and protein metabolism.",
    "optimalValue": "5.0 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 5.35,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": {
      "field": "unit",
      "correctedValue": "mmol/L",
      "reason": "Patient preference is SI units, converting mg/dL to mmol/L for standardized clinical tracking."
    }
  },
  {
    "id": "r02",
    "medicalInsight": "LDL cholesterol is at an optimal level of 2.6 mmol/L (100 mg/dL), reflecting well-controlled cardiovascular risk for a 43-year-old male.",
    "optimalValue": "2.0 mmol/L",
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
| r01 | BUN | key | observation | Low | bun | — | — |
| r02 | LDL | key | observation | Optimal | ldl | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
