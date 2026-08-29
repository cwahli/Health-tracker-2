# C3 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: Health-tracker/.env
- Score: **PASS** (0 known / 10 unknown)

## System instruction (verbatim)

```
You are an expert clinical laboratory AI reviewing a patient's biomarker panel.
Patient Profile: 43-year-old Chinese male, Unit Preference: SI.

For each biomarker:
- id: matching id
- medicalInsight: Provide a concise, clinically accurate insight. (If an accurate existingInsight is already provided in the input, return "" to save tokens). If previous value exists, cite the trend. Consider patient ethnography (e.g. for Chinese patients, HbA1c >=39 indicates elevated prediabetes risk).
- customRangeOverlay: If agreeing with range, return "". If missing ethnic thresholds (e.g. HbA1c for Chinese patients), provide FULL multi-bracket range: "Elevated (Diabetes): >=48; Elevated: >=39; Normal: >=20".
- optimalValue: If existing is accurate, return "". Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it).
- editReason: If replacing/correcting existing user values or suboptimal optimalValue, explain why. Otherwise "".
- logs: Extract all logs with standardized "YYYY-MM-DD" dates and comments. Convert US units to patient's unitPreference (e.g. 1.1 mg/dL creatinine → 97 umol/L).
- DICTIONARY CORRECTION: If dictionary info has typos/errors (e.g. Total Protein 6-8 g/L instead of 60-80 g/L), output dictionaryCorrection: { field, correctedValue, reason }. Otherwise null.
- UNCATALOGED (MISS): If not in dictionary, output match="none", writeTarget="pending", key=null, and newCatalogDraft: { suggestedKey, name, unit, aliases, normalRange, description, riskCategories }.

JSON { "rows": [...] }.
```

## User send (once)

```
"05-Jun-2026","Se prostate specific Ag level","1.41 ug/L","- 2.49 ug/L","(OlaFRS) - 01. Satisfactory - No Action The normal ranges provided are for patients who have a diagnostic PSA to detect prostate cancer. In patients
"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""
"05-Jun-2026","Serum potassium","4.3 mmol/L","3.5 - 5.3 mmol/L",""
"05-Jun-2026","Serum alkaline phosphatase","39 U/L","30 - 130 U/L",""
"05-Jun-2026","Serum total bilirubin level","16 umol/L","- 21 umol/L",""
"05-Jun-2026","Serum globulin","35 g/L","22 - 38 g/L",""
"05-Jun-2026","Serum calcium","2.47 mmol/L","- mmol/L",""
"05-Jun-2026","Serum adjusted calcium conc","2.37 mmol/L","2.08 - 2.48 mmol/L","Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
"05-Jun-2026","Serum inorganic phosphate","1.12 mmol/L","0.80 - 1.50 mmol/L",""
"05-Jun-2026","Red blood cell distribut width","11.8 %","10.5 - 16.0 %",""
Se prostate specific Ag level  1.41 ug/L
Serum sodium  143 mmol/L
Serum potassium  4.3 mmol/L
Serum alkaline phosphatase  39 U/L
Serum total bilirubin level  16 umol/L
Serum globulin  35 g/L
Serum calcium  2.47 mmol/L
Serum adjusted calcium conc  2.37 mmol/L
Serum inorganic phosphate  1.12 mmol/L
Red blood cell distribut width  11.8 %
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | Se prostate specific Ag level | none | pending | — |
| r02 | Serum sodium | none | pending | — |
| r03 | Serum potassium | none | pending | — |
| r04 | Serum alkaline phosphatase | none | pending | — |
| r05 | Serum total bilirubin level | none | pending | — |
| r06 | Serum globulin | none | pending | — |
| r07 | Serum calcium | none | pending | — |
| r08 | Serum adjusted calcium conc | none | pending | — |
| r09 | Serum inorganic phosphate | none | pending | — |
| r10 | Red blood cell distribut width | none | pending | — |

## Agent turns (full payload sent + model output)

### Turn 1 (miss) — r01, r02, r03, r04, r05, r06, r07, r08, r09, r10 (10 rows, 7133ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
"05-Jun-2026","Se prostate specific Ag level","1.41 ug/L","- 2.49 ug/L","(OlaFRS) - 01. Satisfactory - No Action The normal ranges provided are for patients who have a diagnostic PSA to detect prostate cancer. In patients
"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""
"05-Jun-2026","Serum potassium","4.3 mmol/L","3.5 - 5.3 mmol/L",""
"05-Jun-2026","Serum alkaline phosphatase","39 U/L","30 - 130 U/L",""
"05-Jun-2026","Serum total bilirubin level","16 umol/L","- 21 umol/L",""
"05-Jun-2026","Serum globulin","35 g/L","22 - 38 g/L",""
"05-Jun-2026","Serum calcium","2.47 mmol/L","- mmol/L",""
"05-Jun-2026","Serum adjusted calcium conc","2.37 mmol/L","2.08 - 2.48 mmol/L","Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
"05-Jun-2026","Serum inorganic phosphate","1.12 mmol/L","0.80 - 1.50 mmol/L",""
"05-Jun-2026","Red blood cell distribut width","11.8 %","10.5 - 16.0 %",""
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "Se prostate specific Ag level",
      "value": 1.41,
      "unit": "ug/L",
      "range": "- 2.49 ug/L"
    },
    {
      "id": "r02",
      "name": "Serum sodium",
      "value": 143,
      "unit": "mmol/L",
      "range": "133 - 146 mmol/L"
    },
    {
      "id": "r03",
      "name": "Serum potassium",
      "value": 4.3,
      "unit": "mmol/L",
      "range": "3.5 - 5.3 mmol/L"
    },
    {
      "id": "r04",
      "name": "Serum alkaline phosphatase",
      "value": 39,
      "unit": "U/L",
      "range": "30 - 130 U/L"
    },
    {
      "id": "r05",
      "name": "Serum total bilirubin level",
      "value": 16,
      "unit": "umol/L",
      "range": "- 21 umol/L"
    },
    {
      "id": "r06",
      "name": "Serum globulin",
      "value": 35,
      "unit": "g/L",
      "range": "22 - 38 g/L"
    },
    {
      "id": "r07",
      "name": "Serum calcium",
      "value": 2.47,
      "unit": "mmol/L",
      "range": "- mmol/L"
    },
    {
      "id": "r08",
      "name": "Serum adjusted calcium conc",
      "value": 2.37,
      "unit": "mmol/L",
      "range": "2.08 - 2.48 mmol/L"
    },
    {
      "id": "r09",
      "name": "Serum inorganic phosphate",
      "value": 1.12,
      "unit": "mmol/L",
      "range": "0.80 - 1.50 mmol/L"
    },
    {
      "id": "r10",
      "name": "Red blood cell distribut width",
      "value": 11.8,
      "unit": "%",
      "range": "10.5 - 16.0 %"
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "r01",
    "medicalInsight": "PSA is within the normal reference range for a 43-year-old male.",
    "optimalValue": "1.0 ug/L",
    "editReason": "Providing standard target value.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.41,
        "unit": "ug/L",
        "comment": "Satisfactory - No Action"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "psa",
      "name": "Prostate Specific Antigen",
      "unit": "ug/L",
      "aliases": [
        "Se prostate specific Ag level",
        "PSA"
      ],
      "normalRange": "< 2.49 ug/L",
      "description": "Blood test used primarily to screen for prostate cancer.",
      "riskCategories": [
        "Prostate Health"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r02",
    "medicalInsight": "Serum sodium level is normal, indicating good hydration and electrolyte balance.",
    "optimalValue": "140 mmol/L",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 143,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "sodium",
      "name": "Serum Sodium",
      "unit": "mmol/L",
      "aliases": [
        "Serum sodium"
      ],
      "normalRange": "133 - 146 mmol/L",
      "description": "Electrolyte and mineral that helps keep water and electrolyte balance of the body.",
      "riskCategories": [
        "Electrolytes"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r03",
    "medicalInsight": "Serum potassium is within optimal limits.",
    "optimalValue": "4.4 mmol/L",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 4.3,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "potassium",
      "name": "Serum Potassium",
      "unit": "mmol/L",
      "aliases": [
        "Serum potassium"
      ],
      "normalRange": "3.5 - 5.3 mmol/L",
      "description": "Crucial electrolyte for nerve and muscle function, especially the heart.",
      "riskCategories": [
        "Electrolytes"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r04",
    "medicalInsight": "Alkaline phosphatase activity is normal.",
    "optimalValue": "70 U/L",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 39,
        "unit": "U/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "alp",
      "name": "Serum Alkaline Phosphatase",
      "unit": "U/L",
      "aliases": [
        "Serum alkaline phosphatase"
      ],
      "normalRange": "30 - 130 U/L",
      "description": "Enzyme related to the liver, biliary tract, and bones.",
      "riskCategories": [
        "Liver Function"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r05",
    "medicalInsight": "Total bilirubin is within normal limits.",
    "optimalValue": "10 umol/L",
    "editReason": "Providing standard optimal target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 16,
        "unit": "umol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "total_bilirubin",
      "name": "Serum Total Bilirubin",
      "unit": "umol/L",
      "aliases": [
        "Serum total bilirubin level"
      ],
      "normalRange": "< 21 umol/L",
      "description": "Yellow breakdown product of normal heme catabolism.",
      "riskCategories": [
        "Liver Function"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r06",
    "medicalInsight": "Serum globulin is normal.",
    "optimalValue": "30 g/L",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 35,
        "unit": "g/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "globulin",
      "name": "Serum Globulin",
      "unit": "g/L",
      "aliases": [
        "Serum globulin"
      ],
      "normalRange": "22 - 38 g/L",
      "description": "Group of proteins in the blood, including antibodies.",
      "riskCategories": [
        "Liver Function",
        "Proteins"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r07",
    "medicalInsight": "Serum calcium is within normal physiological range.",
    "optimalValue": "2.35 mmol/L",
    "editReason": "Providing standard optimal target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.47,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "calcium",
      "name": "Serum Calcium",
      "unit": "mmol/L",
      "aliases": [
        "Serum calcium"
      ],
      "normalRange": "2.10 - 2.55 mmol/L",
      "description": "Essential mineral for bone health and cellular signaling.",
      "riskCategories": [
        "Minerals"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r08",
    "medicalInsight": "Adjusted calcium is within the expected reference interval.",
    "optimalValue": "2.30 mmol/L",
    "editReason": "Providing standard optimal target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.37,
        "unit": "mmol/L",
        "comment": "Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "adjusted_calcium",
      "name": "Serum Adjusted Calcium Concentration",
      "unit": "mmol/L",
      "aliases": [
        "Serum adjusted calcium conc"
      ],
      "normalRange": "2.08 - 2.48 mmol/L",
      "description": "Calcium level adjusted for serum albumin concentration.",
      "riskCategories": [
        "Minerals"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r09",
    "medicalInsight": "Inorganic phosphate is normal.",
    "optimalValue": "1.15 mmol/L",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.12,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "phosphate",
      "name": "Serum Inorganic Phosphate",
      "unit": "mmol/L",
      "aliases": [
        "Serum inorganic phosphate"
      ],
      "normalRange": "0.80 - 1.50 mmol/L",
      "description": "Electrolyte playing an important role in bone formation and energy storage.",
      "riskCategories": [
        "Minerals"
      ]
    },
    "customRangeOverlay": null
  },
  {
    "id": "r10",
    "medicalInsight": "Red blood cell distribution width (RDW) is normal, indicating uniform red blood cell size.",
    "optimalValue": "13.0 %",
    "editReason": "Providing standard mid-range target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 11.8,
        "unit": "%",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "rdw",
      "name": "Red Blood Cell Distribution Width",
      "unit": "%",
      "aliases": [
        "Red blood cell distribut width",
        "RDW"
      ],
      "normalRange": "10.5 - 16.0 %",
      "description": "Measure of variation in red blood cell width and volume.",
      "riskCategories": [
        "Hematology"
      ]
    },
    "customRangeOverlay": null
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | Se prostate specific Ag level | none | pending | — | — | psa | — |
| r02 | Serum sodium | none | pending | — | — | sodium | — |
| r03 | Serum potassium | none | pending | — | — | potassium | — |
| r04 | Serum alkaline phosphatase | none | pending | — | — | alp | — |
| r05 | Serum total bilirubin level | none | pending | — | — | total_bilirubin | — |
| r06 | Serum globulin | none | pending | — | — | globulin | — |
| r07 | Serum calcium | none | pending | — | — | calcium | — |
| r08 | Serum adjusted calcium conc | none | pending | — | — | adjusted_calcium | — |
| r09 | Serum inorganic phosphate | none | pending | — | — | phosphate | — |
| r10 | Red blood cell distribut width | none | pending | — | — | rdw | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
