# C3 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (0 known / 10 unknown)

## System instruction (verbatim)

```
You are an expert clinical laboratory AI reviewing a patient's biomarker panel.
Patient Profile: 43-year-old Chinese male, Unit Preference: SI.

For each biomarker:
- id: matching id
- medicalInsight: Provide a concise, clinically accurate insight for every row (including optimal/normal baseline markers). Cite trend if previous values exist. Consider patient ethnography (e.g. for Chinese patients, HbA1c >=39 indicates elevated prediabetes risk).
- customRangeOverlay: If agreeing with range, return "". If missing thresholds or ethnic demographics, provide FULL multi-bracket range specifying the profile source and clinical names. Format MUST be "[Profile] Clinical Name: Range; Clinical Name: Range". Example: "[Chinese Ethnicity] Elevated (Diabetes): >=48; Elevated: >=39; Optimal: <39" or "[Western Standard] High: >104; Normal: 64-104; Low: <64". If multiple demographic profiles exist, provide all of them.
- optimalValue: If existing is accurate, return "". Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it).
- editReason: If replacing/correcting existing user values or suboptimal optimalValue, explain why. Otherwise "".
- logs: Extract all logs with standardized "YYYY-MM-DD" dates, labName if mentioned (e.g. "US lab", "GP Clinic"), and comments. Convert US units to patient's unitPreference with standard clinical integer rounding (e.g. 1.1 mg/dL creatinine → 97 umol/L, not decimals like 97.24). Standardize scientific units (e.g. 10^9/L).
- DICTIONARY CORRECTION: If dictionary info has typos/errors (e.g. Total Protein 6-8 g/L instead of 60-80 g/L), output dictionaryCorrection: { field, correctedValue, reason }. Otherwise null.
- UNCATALOGED (MISS): If not in dictionary, output match="none", writeTarget="pending", key=null, and newCatalogDraft: { suggestedKey, name, unit, aliases, normalRange, description, riskCategories }. NOTE: normalRange MUST follow the same bracketed profile format with clinical names, e.g., "[Western Standard] High: >1.4; Optimal: 0.5-1.4; Low: <0.5".

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
"05-Jun-2026","Homocysteine","10.2 umol/L","< 15.0 umol/L",""
Se prostate specific Ag level  1.41 ug/L
Serum sodium  143 mmol/L
Serum potassium  4.3 mmol/L
Serum alkaline phosphatase  39 U/L
Serum total bilirubin level  16 umol/L
Serum globulin  35 g/L
Serum calcium  2.47 mmol/L
Serum adjusted calcium conc  2.37 mmol/L
Serum inorganic phosphate  1.12 mmol/L
Homocysteine  10.2 umol/L
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
| r10 | Homocysteine | none | pending | — |

## Agent turns (full payload sent + model output)

### Turn 1 (miss) — r01, r02, r03, r04, r05, r06, r07, r08, r09, r10 (10 rows, 7992ms)

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
"05-Jun-2026","Homocysteine","10.2 umol/L","< 15.0 umol/L",""
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "Se prostate specific Ag level",
      "value": 1.41,
      "unit": "ug/L",
      "date": "2026-06-05",
      "range": "- 2.49 ug/L"
    },
    {
      "id": "r02",
      "name": "Serum sodium",
      "value": 143,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "133 - 146 mmol/L"
    },
    {
      "id": "r03",
      "name": "Serum potassium",
      "value": 4.3,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "3.5 - 5.3 mmol/L"
    },
    {
      "id": "r04",
      "name": "Serum alkaline phosphatase",
      "value": 39,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "30 - 130 U/L"
    },
    {
      "id": "r05",
      "name": "Serum total bilirubin level",
      "value": 16,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "- 21 umol/L"
    },
    {
      "id": "r06",
      "name": "Serum globulin",
      "value": 35,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "22 - 38 g/L"
    },
    {
      "id": "r07",
      "name": "Serum calcium",
      "value": 2.47,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "- mmol/L"
    },
    {
      "id": "r08",
      "name": "Serum adjusted calcium conc",
      "value": 2.37,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "2.08 - 2.48 mmol/L"
    },
    {
      "id": "r09",
      "name": "Serum inorganic phosphate",
      "value": 1.12,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "0.80 - 1.50 mmol/L"
    },
    {
      "id": "r10",
      "name": "Homocysteine",
      "value": 10.2,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "< 15.0 umol/L"
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "r01",
    "medicalInsight": "Prostate-specific antigen (PSA) level is 1.41 ug/L, which is within the normal reference range, indicating a satisfactory result with no acute prostatic concern for this 43-year-old male.",
    "optimalValue": "1.0 ug/L",
    "editReason": "Target set to optimal low-risk baseline for young adult males.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.41,
        "unit": "ug/L",
        "comment": "OlaFRS - Satisfactory - No Action"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "se_prostate_specific_ag_level",
      "name": "Se prostate specific Ag level",
      "unit": "ug/L",
      "aliases": [
        "PSA",
        "Prostate Specific Antigen"
      ],
      "normalRange": "[Standard] Normal: <=2.49; High: >2.49",
      "description": "Prostate-specific antigen test measures the level of PSA in the blood.",
      "riskCategories": [
        "Prostate Health"
      ]
    },
    "customRangeOverlay": "[Standard] Normal: <=2.49; High: >2.49"
  },
  {
    "id": "r02",
    "medicalInsight": "Serum sodium is 143 mmol/L, reflecting normal fluid and electrolyte balance.",
    "optimalValue": "140 mmol/L",
    "editReason": "Mid-normal physiological target.",
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
      "suggestedKey": "serum_sodium",
      "name": "Serum sodium",
      "unit": "mmol/L",
      "aliases": [
        "Sodium",
        "Na"
      ],
      "normalRange": "[Standard] High: >146; Normal: 133-146; Low: <133",
      "description": "Measures sodium level in blood for hydration and electrolyte status.",
      "riskCategories": [
        "Electrolytes"
      ]
    },
    "customRangeOverlay": "[Standard] High: >146; Normal: 133-146; Low: <133"
  },
  {
    "id": "r03",
    "medicalInsight": "Serum potassium is 4.3 mmol/L, well within the healthy reference range.",
    "optimalValue": "4.2 mmol/L",
    "editReason": "Optimal homeostatic target for cardiac and neuromuscular function.",
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
      "suggestedKey": "serum_potassium",
      "name": "Serum potassium",
      "unit": "mmol/L",
      "aliases": [
        "Potassium",
        "K"
      ],
      "normalRange": "[Standard] High: >5.3; Normal: 3.5-5.3; Low: <3.5",
      "description": "Measures potassium levels crucial for cellular and cardiac function.",
      "riskCategories": [
        "Electrolytes"
      ]
    },
    "customRangeOverlay": "[Standard] High: >5.3; Normal: 3.5-5.3; Low: <3.5"
  },
  {
    "id": "r04",
    "medicalInsight": "Serum alkaline phosphatase is 39 U/L, indicating normal hepatobiliary and bone metabolic activity.",
    "optimalValue": "70 U/L",
    "editReason": "Center of typical healthy adult reference interval.",
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
      "suggestedKey": "serum_alkaline_phosphatase",
      "name": "Serum alkaline phosphatase",
      "unit": "U/L",
      "aliases": [
        "ALP",
        "Alkaline Phosphatase"
      ],
      "normalRange": "[Standard] High: >130; Normal: 30-130; Low: <30",
      "description": "Enzyme associated with liver, biliary tract, and bone.",
      "riskCategories": [
        "Liver Function",
        "Bone Health"
      ]
    },
    "customRangeOverlay": "[Standard] High: >130; Normal: 30-130; Low: <30"
  },
  {
    "id": "r05",
    "medicalInsight": "Serum total bilirubin is 16 umol/L, falling within normal physiological limits.",
    "optimalValue": "10 umol/L",
    "editReason": "Optimal baseline for hepatic clearance.",
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
      "suggestedKey": "serum_total_bilirubin_level",
      "name": "Serum total bilirubin level",
      "unit": "umol/L",
      "aliases": [
        "Total Bilirubin",
        "Bili"
      ],
      "normalRange": "[Standard] High: >21; Normal: <=21",
      "description": "Measures total bilirubin resulting from hemoglobin breakdown.",
      "riskCategories": [
        "Liver Function"
      ]
    },
    "customRangeOverlay": "[Standard] High: >21; Normal: <=21"
  },
  {
    "id": "r06",
    "medicalInsight": "Serum globulin is 35 g/L, representing a normal immunological and protein synthetic profile.",
    "optimalValue": "28 g/L",
    "editReason": "Optimal median target.",
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
      "suggestedKey": "serum_globulin",
      "name": "Serum globulin",
      "unit": "g/L",
      "aliases": [
        "Globulin"
      ],
      "normalRange": "[Standard] High: >38; Normal: 22-38; Low: <22",
      "description": "Measures non-albumin serum proteins involved in immune response.",
      "riskCategories": [
        "Protein Status",
        "Immune Function"
      ]
    },
    "customRangeOverlay": "[Standard] High: >38; Normal: 22-38; Low: <22"
  },
  {
    "id": "r07",
    "medicalInsight": "Serum calcium is 2.47 mmol/L, reflecting normal unadjusted systemic calcium levels.",
    "optimalValue": "2.35 mmol/L",
    "editReason": "Standard physiological target for systemic calcium.",
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
      "suggestedKey": "serum_calcium",
      "name": "Serum calcium",
      "unit": "mmol/L",
      "aliases": [
        "Calcium",
        "Ca"
      ],
      "normalRange": "[Standard] Normal: 2.10-2.55; High: >2.55; Low: <2.10",
      "description": "Measures total calcium in the blood.",
      "riskCategories": [
        "Bone Health",
        "Mineral Metabolism"
      ]
    },
    "customRangeOverlay": "[Standard] Normal: 2.10-2.55; High: >2.55; Low: <2.10"
  },
  {
    "id": "r08",
    "medicalInsight": "Serum adjusted calcium concentration is 2.37 mmol/L, well within the normal updated reference range, indicating proper protein-corrected calcium homeostasis.",
    "optimalValue": "2.30 mmol/L",
    "editReason": "Optimal target for albumin-adjusted calcium.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.37,
        "unit": "mmol/L",
        "comment": "New adjusted calcium equation and Abbott Alinity reference ranges in use."
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_adjusted_calcium_conc",
      "name": "Serum adjusted calcium conc",
      "unit": "mmol/L",
      "aliases": [
        "Adjusted Calcium",
        "Corrected Calcium"
      ],
      "normalRange": "[Standard] High: >2.48; Normal: 2.08-2.48; Low: <2.08",
      "description": "Calcium level adjusted for serum albumin levels.",
      "riskCategories": [
        "Bone Health",
        "Mineral Metabolism"
      ]
    },
    "customRangeOverlay": "[Standard] High: >2.48; Normal: 2.08-2.48; Low: <2.08"
  },
  {
    "id": "r09",
    "medicalInsight": "Serum inorganic phosphate is 1.12 mmol/L, supporting healthy cellular energy metabolism and bone homeostasis.",
    "optimalValue": "1.10 mmol/L",
    "editReason": "Ideal central phosphate concentration.",
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
      "suggestedKey": "serum_inorganic_phosphate",
      "name": "Serum inorganic phosphate",
      "unit": "mmol/L",
      "aliases": [
        "Phosphate",
        "Phosphorus"
      ],
      "normalRange": "[Standard] High: >1.50; Normal: 0.80-1.50; Low: <0.80",
      "description": "Measures inorganic phosphorus levels in the blood.",
      "riskCategories": [
        "Bone Health",
        "Mineral Metabolism"
      ]
    },
    "customRangeOverlay": "[Standard] High: >1.50; Normal: 0.80-1.50; Low: <0.80"
  },
  {
    "id": "r10",
    "medicalInsight": "Homocysteine is 10.2 umol/L, which is within the optimal low-risk threshold (< 15.0 umol/L), indicating healthy one-carbon metabolism and vitamin B status.",
    "optimalValue": "8.0 umol/L",
    "editReason": "Optimal target for cardiovascular and methylation health.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 10.2,
        "unit": "umol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "homocysteine",
      "name": "Homocysteine",
      "unit": "umol/L",
      "aliases": [
        "Total Homocysteine",
        "Hcy"
      ],
      "normalRange": "[Standard] Normal: <15.0; High: >=15.0",
      "description": "Amino acid in the blood associated with cardiovascular and methylation status when elevated.",
      "riskCategories": [
        "Cardiovascular Health",
        "Methylation"
      ]
    },
    "customRangeOverlay": "[Standard] Normal: <15.0; High: >=15.0"
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | Se prostate specific Ag level | none | pending | — | — | se_prostate_specific_ag_level | — |
| r02 | Serum sodium | none | pending | — | — | serum_sodium | — |
| r03 | Serum potassium | none | pending | — | — | serum_potassium | — |
| r04 | Serum alkaline phosphatase | none | pending | — | — | serum_alkaline_phosphatase | — |
| r05 | Serum total bilirubin level | none | pending | — | — | serum_total_bilirubin_level | — |
| r06 | Serum globulin | none | pending | — | — | serum_globulin | — |
| r07 | Serum calcium | none | pending | — | — | serum_calcium | — |
| r08 | Serum adjusted calcium conc | none | pending | — | — | serum_adjusted_calcium_conc | — |
| r09 | Serum inorganic phosphate | none | pending | — | — | serum_inorganic_phosphate | — |
| r10 | Homocysteine | none | pending | — | — | homocysteine | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
