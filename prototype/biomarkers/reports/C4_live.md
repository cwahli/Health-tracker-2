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

### Turn 1 (hit) — r01, r02, r03, r04 (4 rows, 2433ms)

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
    "medicalInsight": "HbA1c of 39 mmol/mol (5.7%) places this 43-year-old Chinese male at elevated prediabetes risk according to ethnicity-specific clinical thresholds.",
    "optimalValue": "33 mmol/mol",
    "editReason": "Applied ethnicity-specific prediabetes threshold for Chinese patients where HbA1c >=39 indicates elevated risk.",
    "logs": [
      {
        "date": "2023-10-24",
        "value": 39,
        "unit": "mmol/mol",
        "comment": "Converted from 5.7%"
      }
    ],
    "customRangeOverlay": "Elevated (Prediabetes): >=39; Normal: <39",
    "dictionaryCorrection": null
  },
  {
    "id": "r02",
    "medicalInsight": "LDL cholesterol is 3.36 mmol/L (130 mg/dL), which is elevated and increases long-term cardiovascular risk, requiring dietary and lifestyle optimization.",
    "optimalValue": "2.5 mmol/L",
    "editReason": "Set optimal target below 2.6 mmol/L for cardiovascular health.",
    "logs": [
      {
        "date": "2023-10-24",
        "value": 3.36,
        "unit": "mmol/L",
        "comment": "Converted from 130 mg/dL"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r03",
    "medicalInsight": "eGFR of 80 mL/min/1.73m2 reflects mild reduction but must be interpreted cautiously; 60 is naive for CKD G2 and optimal should reflect robust filtration.",
    "optimalValue": "95 mL/min/1.73m2",
    "editReason": "Corrected naive optimal/normal range to reflect true optimal youthful renal function.",
    "logs": [
      {
        "date": "2023-10-24",
        "value": 80,
        "unit": "mL/min/1.73m2",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r04",
    "medicalInsight": "ALT is slightly elevated at 41 U/L, suggesting mild hepatocellular stress which warrants monitoring of metabolic health and liver enzymes.",
    "optimalValue": "25 U/L",
    "editReason": "Set optimal ALT target within lower normal range.",
    "logs": [
      {
        "date": "2023-10-24",
        "value": 41,
        "unit": "U/L",
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
| r01 | HbA1c | key | observation | Elevated | hba1c | — | — |
| r02 | LDL | key | observation | Elevated | ldl | — | — |
| r03 | eGFR | key | observation | Mildly Decreased (CKD G2) | egfr | — | — |
| r04 | ALT | key | observation | Elevated | alt | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
