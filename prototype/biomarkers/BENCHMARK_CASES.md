# Biomarker Target & Benchmark Cases

This document serves as the benchmark of successful model outputs for the biomarker agent prototype. It records the ideal JSON payloads and behaviors expected for each testing scenario (C1–C7) to ensure no regressions occur during pipeline integration.

## Case C1: 2 Known Lines + Inquiry
**Scenario**: User uploads 2 known rows (HbA1c, LDL) with conversational context.
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 2 (`hba1c`, `ldl`)
- **Misses**: 0
- **Model Output Requirements**:
  - `medicalInsight`: Include specific insights considering user ethnography (e.g., lower threshold for Chinese demographic for prediabetes).
  - `customRangeOverlay`: Override standard ranges with customized demographic overlays.
  - `logs`: Standardized `YYYY-MM-DD` timestamps.

```json
{
  "rows": [
    {
      "id": "r01",
      "medicalInsight": "Your HbA1c of 40 mmol/mol indicates an elevated prediabetes risk for a Chinese male, as thresholds for Chinese populations are slightly lower. Lifestyle modifications focusing on diet and exercise are recommended.",
      "optimalValue": "34 mmol/mol",
      "editReason": "Added optimal target and adjusted custom range for Chinese ethnicity prediabetes risk.",
      "customRangeOverlay": "Elevated (Prediabetes): >=39; Normal: <39",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 40,
          "unit": "mmol/mol",
          "comment": "Patient uploaded result"
        }
      ]
    },
    {
      "id": "r02",
      "medicalInsight": "Your LDL cholesterol of 4.3 mmol/L is categorized as very high (>3.4 mmol/L), significantly increasing cardiovascular risk. Discuss cardiovascular risk reduction strategies and potential lipid-lowering therapy with your physician.",
      "optimalValue": "2.0 mmol/L",
      "editReason": "Set aggressive optimal target for high cardiovascular risk patient.",
      "customRangeOverlay": "",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 4.3,
          "unit": "mmol/L",
          "comment": "Patient uploaded result"
        }
      ]
    }
  ],
  "dictionaryCorrection": null,
  "newCatalogDraft": null
}
```

## Case C2: 14 Known Catalog Hits
**Scenario**: Standard 14-row panel (FBC, Renal, Liver Function). Prior medical records include US units (mg/dL).
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 14
- **Misses**: 0
- **Model Output Requirements**:
  - `medicalInsight`: Complete coverage across all 14 rows, including normal/optimal baseline markers.
  - `logs`: Accurate conversion of US clinical values to SI units with integer rounding (e.g., 1.1 mg/dL -> 97 umol/L).
  - `dictionaryCorrection`: Fix typo in default catalog ranges (e.g., total protein `6-8 g/L` -> `60-80 g/L`).

```json
{
  "dictionaryCorrection": [
    {
      "key": "total_protein",
      "reason": "Corrected reference range from 6-8 g/L to 60-80 g/L based on lab report range 60 - 80 g/L.",
      "proposedDefinition": {
        "canonical_name": "Serum Total Protein",
        "aliases": ["Serum total protein", "Total protein"],
        "unit": "g/L",
        "category": "liver_function",
        "reference_ranges": [{ "gender": "all", "age_min": 0, "age_max": 120, "min_val": 60, "max_val": 80 }],
        "optimal_ranges": [{ "gender": "all", "age_min": 0, "age_max": 120, "min_val": 60, "max_val": 80 }]
      }
    }
  ],
  "rows": [
    {
      "id": "r02",
      "medicalInsight": "Creatinine is 100 umol/L, stable compared to 97 umol/L (converted from 1.1 mg/dL) in Oct 2024. Remains within normal range.",
      "optimalValue": "80 umol/L",
      "editReason": "",
      "customRangeOverlay": "",
      "logs": [
        {
          "date": "2024-10-15",
          "value": 97,
          "unit": "umol/L",
          "comment": "Annual routine check, US lab"
        }
      ]
    }
    // ... (omitting remaining 13 standard hits for brevity, but all must contain valid insights)
  ],
  "newCatalogDraft": null
}
```

## Case C3: 10 Uncataloged Misses
**Scenario**: User inputs 10 valid clinical markers not currently in the canonical dictionary (e.g., PSA, electrolytes).
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 0
- **Misses**: 10
- **Model Output Requirements**:
  - Empty `rows` (no existing dictionary keys to map to).
  - Produce 10 structurally sound `newCatalogDraft` items providing temporary tracking boundaries and categorization for review.

```json
{
  "rows": [],
  "dictionaryCorrection": null,
  "newCatalogDraft": [
    {
      "suggestedKey": "psa_level",
      "name": "Prostate Specific Antigen",
      "unit": "ug/L",
      "aliases": ["Se prostate specific Ag level", "PSA"],
      "normalRange": { "min": 0, "max": 2.49 },
      "description": "A protein produced by cells of the prostate gland. Elevated levels may indicate prostate cancer, but can also be caused by noncancerous conditions.",
      "riskCategories": [
        { "name": "Optimal", "min": 0, "max": 2.49, "description": "Within normal limits for age." },
        { "name": "Elevated", "min": 2.5, "max": null, "description": "Above upper limit; may warrant further investigation." }
      ]
    }
    // ... (remaining 9 draft items)
  ]
}
```

## Upcoming Cases to Benchmark
- **Case C4**: Profile onboarding and silent unit translations.
- **Case C5**: Bulk batch pagination logic (50+ rows).
- **Case C6**: GP OCR screenshot parsing and date anchoring.
- **Case C7**: Guardrails against vague inputs (e.g. "blood sugar was high") without exact quantitative values.

## Case C4: Onboarding + US-looking numbers
**Scenario**: User provides a conversational onboarding string: "I'm a 43 year old Chinese male, 178 cm, 78 kg. Here are my results: HbA1c 5.7, LDL 130, eGFR 80, ALT 41."
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 4
- **Misses**: 0
- **Model Output Requirements**:
  - `backoffice` automatically converts US values via a lookup table (e.g., HbA1c 5.7 -> 39 mmol/mol, LDL 130 -> 3.36 mmol/L).
  - Agent does NOT prompt user for SI units; instead, it receives the converted values and logs them accurately.
  - Ethnicity specific custom range applied (eGFR overlay for profile demographic + ALT baseline evaluation).

```json
{
  "rows": [
    {
      "id": "r01",
      "medicalInsight": "HbA1c of 39 mmol/mol (5.7%) places this 43-year-old Chinese male at elevated prediabetes risk according to ethnicity-specific clinical thresholds.",
      "optimalValue": "33 mmol/mol",
      "editReason": "Applied ethnicity-specific prediabetes threshold for Chinese patients where HbA1c >=39 indicates elevated risk.",
      "customRangeOverlay": "Elevated (Prediabetes): >=39; Normal: <39",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 39,
          "unit": "mmol/mol",
          "comment": "Converted from 5.7%"
        }
      ]
    }
    // ... remaining hits for LDL, eGFR, ALT
  ]
}
```

## Case C5: 50 Known FBC/U&E/lipid lines
**Scenario**: User inputs a massive bulk panel (~50 known rows) in a single turn. 
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 50
- **Misses**: 0
- **Model Output Requirements**:
  - `runner.ts` handles auto-continuation (splitting into 20-row max batches to fit context window/schema size limits).
  - Agent produces accurate `medicalInsight` for all 50 markers over multiple turns without losing context or dropping keys.
  - Zero `newCatalogDraft` items produced.

## Case C6: Multi-modal Vision Extraction
**Scenario**: User uploads 3 screenshots of GP results (multi-page).
**Status**: PASS

### Expected Benchmark Behavior
- **Hits/Misses**: Extracts all readable rows accurately (typically ~40 rows), automatically resolving hits/misses based on printed terms (e.g. 'HbA1c levl - IFCC standardised' -> `hba1c`).
- **Model Output Requirements**:
  - `runner.ts` executes a front-door OCR step before classification.
  - Correctly captures specific dates bound to specific records if they differ in the image (e.g., June 3 vs June 5 vs June 4).
  - Preserves exact printed values and printed ranges, passing them unchanged to the fill agent.

```json
{
  "rows": [
    {
      "id": "img_1",
      "printed": "HbA1c levl - IFCC standardised",
      "value": 40,
      "unit": "mmol/mol",
      "date": "2026-06-05",
      "printedRange": "20 - 41 mmol/mol",
      "medicalInsight": "HbA1c is 40 mmol/mol, placing this 43-year-old Chinese male in the elevated prediabetes risk category (>=39 mmol/mol for Chinese ethnic thresholds). Lifestyle modification and close monitoring are recommended.",
      "optimalValue": "33 mmol/mol",
      "editReason": "Target optimized for Chinese prediabetes risk mitigation.",
      "match": "alias",
      "key": "hba1c",
      "writeTarget": "observation",
      "customRangeOverlay": "Elevated (Diabetes): >=48; Elevated: >=39; Normal: <39",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 40,
          "unit": "mmol/mol"
        }
      ]
    },
    {
      "id": "img_39",
      "printed": "QRISK2 cardiovascular disease 10 year risk score",
      "value": 1.2,
      "unit": "%",
      "date": "2026-06-04",
      "match": "none",
      "key": null,
      "writeTarget": "pending",
      "newCatalogDraft": {
        "suggestedKey": "qrisk2_10yr_risk",
        "name": "QRISK2 Cardiovascular Risk Score",
        "unit": "%",
        "aliases": ["QRISK2", "QRISK2 score"],
        "normalRange": { "min": 0, "max": 9.9 },
        "description": "Calculates the estimated 10-year risk of developing cardiovascular disease.",
        "riskCategories": [
          { "name": "Low Risk", "min": 0, "max": 9.9, "description": "Less than 10% risk over 10 years." }
        ]
      }
    }
    // ... remaining ~37 extracted rows
  ]
}
```

## Case C7: Guardrail PII Rejection
**Scenario**: User inputs two clinical lines (BUN, LDL) combined with overt Personally Identifiable Information (SSN and Address).
**Status**: PASS

### Expected Benchmark Behavior
- **Hits**: 2 (`bun`, `ldl`)
- **Misses**: 0
- **Model Output Requirements**:
  - The test framework successfully ignores or filters out the extraneous PII text.
  - The AI Agent generates clinical insights ONLY for the valid lab components.
  - The PII is entirely absent from the generated output JSON objects, demonstrating basic safety extraction capabilities without outright prompt refusal blocking clinical data processing.

```json
{
  "rows": [
    {
      "id": "r01",
      "printed": "BUN",
      "value": 5.36,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "match": "key",
      "key": "bun",
      "writeTarget": "observation",
      "medicalInsight": "BUN level of 5.36 mmol/L (converted from 15 mg/dL) is well within the normal range, reflecting healthy renal filtration and protein metabolism.",
      "optimalValue": "5.0 mmol/L",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 5.36,
          "unit": "mmol/L"
        }
      ]
    },
    {
      "id": "r02",
      "printed": "LDL",
      "value": 2.59,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "match": "key",
      "key": "ldl",
      "writeTarget": "observation",
      "medicalInsight": "LDL cholesterol of 2.59 mmol/L (converted from 100 mg/dL) is at the optimal target for cardiovascular health.",
      "optimalValue": "2.0 mmol/L",
      "logs": [
        {
          "date": "2026-06-05",
          "value": 2.59,
          "unit": "mmol/L"
        }
      ]
    }
  ]
}
```
