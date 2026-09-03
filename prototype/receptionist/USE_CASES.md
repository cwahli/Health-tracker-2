# Receptionist & Front Desk Multi-Agent System — Master Use Cases & Execution Reports

> **Status:** All 10 Use Cases Verified against live Gemini 3.5 Flash Lite  
> **Architecture Standard:** CoALA Memory Lifecycle + `modificationCommand[]` Mutation Engine + System Anchors  
> **Canonical Registry:** Exactly 10 Use Cases (`UC-01` through `UC-10`), with JSON fixtures in `prototype/receptionist/benchmark/`

---

## 1. Architecture & Capabilities

The **Front Desk (Receptionist)** serves as the central clinical and conversational orchestrator of the Health Tracker application:
1. **New User Onboarding**: Welcomes new users, explains the core longevity loop (nutrition tracking vs blood biomarkers), and collects profile metrics (Mifflin-St Jeor BMR prerequisites) with optional interactive UI forms.
2. **Continuous Conversational Memory ($\mathcal{O}(1)$)**: Reads `<existing_memory>`, synthesizes post-turn `lastInteractionSummary`, compacts `keyInsights` ($\le 7$ distilled facts), and bounds `workHistoryLog` ($\le 5$ items with milestone preservation).
3. **Cross-Session Durability**: Falls back to `profile.agentMemory` and `localStorage`, completely eliminating thread-reset amnesia.
4. **Direct Concierge vs Specialist Relay**: Answers status questions directly from `<active_biomarkers>` and `<recent_food_logs>` without launching heavy external agents. Hands off deep work to specialized agents (`health_coach`, `medical`, `agent4`, `agent7`, `food_compare`).
5. **Atomic Historical Mutations (`modificationCommand[]`)**: Resolves system date anchors (`<system_current_date: YYYY-MM-DD>`) to execute multi-field updates and deletions directly on the user's records.
6. **Clinical Safety Guardrails**: Intercepts extreme crash diets or physiological contraindications (e.g. Stage 3 CKD + 300g protein), setting `isDisambiguationRequired: true` and re-questioning the user.

---

## 2. Master Use Case Registry (UC-01 to UC-10)

| Use Case ID | Domain & Capability | Persona & Input Scenario | Target Specialist | Live Execution Score & Status |
|:---:|:---|:---|:---:|:---:|
| **UC-01** | **New User Weight Loss Multi-Turn Onboarding** | 18F, 40kg, 135cm; empty profile; multi-turn intake. | `health_coach` | **100/100 (PASSED)** |
| **UC-02** | **New User General Wellness & Vitality Onboarding** | 28F, 54kg; desk job; afternoon energy crashes & poor sleep. | `health_coach` | **100/100 (PASSED)** |
| **UC-03** | **Existing User Spot Vitals & Quest Lab Relay** | 42M (Alex); logs BP/RHR inline $\to$ relays 11-marker blood panel. | `medical` | **100/100 (PASSED)** |
| **UC-04** | **Multimodal 3-Page Lab Report Ingestion (3 Images)** | 42M; submits 3 NHS GP image scans (Renal, LFT, Bone, Lipids). | `medical` | **100/100 (PASSED)** |
| **UC-05** | **Safety Guardrail & Crash Diet Disambiguation** | 45M; Stage 3 CKD; requests 300g protein / 10kg in 10 days. | Safety Gate $\to$ `health_coach` | **100/100 (PASSED)** |
| **UC-06** | **Direct Health Status & Dietary Concierge** | Existing user; asks about sodium intake vs active blood pressure. | `general_receptionist` (Direct) | **100/100 (PASSED)** |
| **UC-07** | **Multi-Field Historical Mutation Engine** | Existing user; corrects fasting glucose & deletes cuff error. | `modificationCommand[]` | **100/100 (PASSED)** |
| **UC-08** | **Meal Comparison Against Active Biomarkers** | Existing user; compares Chipotle chicken bowl vs Sweetgreen bowl. | `food_compare` (Mode D) | **100/100 (PASSED)** |
| **UC-09** | **Scientific Literature Consensus Relay** | Existing user; scientific inquiry on Berberine vs Metformin. | `agent7` (PubMed) | **100/100 (PASSED)** |
| **UC-10** | **Testing Agent Relay (Biomarker Gaps & Retest)** | Existing user; audits lipid retesting intervals & missing panels. | `agent4` (Test Planner) | **100/100 (PASSED)** |

---

## 3. Detailed Use Case Specifications & Live Execution Reports

---

### UC-01: New User Weight Loss Multi-Turn Onboarding
* **Scenario:** Multi-turn onboarding for an 18yo female from Indonesia (40kg, 135cm) seeking weight loss. Front Desk gathers demographics across turns, consolidates memory, and passes the context to Health Coach.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-01.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Turn 1 (`"I want to loose weight"`):** Status: `needs_info`, Target: `health_coach` (provisional), Missing: `[gender, age, height, weight, activity_level]`. Issued interactive demographic `uiForm`.
* **Turn 2 (`"I'm an 18-year-old woman from Indonesia, 135cm tall"`):** Consolidated `age: 18`, `gender: "female"`, `heightCm: 135`, `ethnicity: "Indonesian"`. Missing: `[weight]`.
* **Turn 3 (`"My current weight is 40kg... student lifestyle with light daily walking"`):** Consolidated `weightKg: 40`, `activityLevel: "lightly_active"`. Set `status: ready_for_handoff`, generated `handoffPayload` for `health_coach`.
* **Downstream Health Coach Execution:** Evaluated low bodyweight (BMI 21.9), formulated recomp and maintenance energy targets, and populated all 31 macro/micronutrient keys (Calories: 1550–1750 kcal, Protein: 55g–65g).

---

### UC-02: New User General Wellness & Vitality Onboarding
* **Scenario:** New user (28F, Singapore, 54kg, 162cm) seeking vitality, energy, and sleep optimization for a sedentary desk job.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-02.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Turn 1 (`"i just want to be healthy"`):** Welcomed user, explained clinical value of profile metrics, issued 5-field onboarding form.
* **Turn 2 (`"28-year-old woman from Singapore, 162cm tall and 54kg... afternoon energy crashes and poor sleep"`):** Extracted biometrics (BMI 20.6), mapped symptoms (energy crashes, poor sleep), set `ready_for_handoff` to `health_coach`.
* **Downstream Health Coach Execution:** Built structured circadian rhythm, hydration, and sleep hygiene plan. Populated all 31 nutrient targets.

---

### UC-03: Existing User Spot Vitals & Quest Lab Report Relay
* **Scenario:** Alex (42M, mild hypertension) logs morning spot vitals in Turn 1 (weight 80.5kg, BP 124/80, RHR 66). Front Desk records them inline. In Turn 2, Alex submits an 11-marker Quest lab report. Front Desk recognizes clinical complexity and relays to Medical Lab Parser.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-03.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Turn 1 (`"Weighed 80.5kg... BP was 124/80, heart rate 66"`):** Updated profile weight, recorded BP/RHR into `keyInsights` and `workHistoryLog`. Status: `needs_info` (inline support mode). Handoff withheld.
* **Turn 2 (`"Quest Diagnostics: Total Chol 228, Trig 175, HDL 42, LDL 151, Glucose 94, HbA1c 5.6%, ALT 38, AST 29, eGFR 95, Creatinine 0.95, hs-CRP 1.8..."`):** Recognized complex multi-panel report, packaged `handoffPayload`, set `targetAgent: medical`, `status: ready_for_handoff`.
* **Downstream Medical Lab Parser Execution:** Extracted all 11 analytes lossless-ly into structured snake_case biomarker logs with units and calibrated guidance.

---

### UC-04: Multimodal 3-Page Clinical Lab Report Ingestion (3 NHS Images)
* **Scenario:** Alex uploads 3 high-resolution NHS GP lab report pages from `prototype/biomarkers/image/`:
  1. `nhs_gp_results_p1_hba1c_renal_lft.png` (HbA1c, Urea, Creatinine, eGFR, ALT, Bilirubin)
  2. `nhs_gp_results_p2_bone_fbc.png` (Bone profile, Calcium, Full Blood Count)
  3. `nhs_gp_results_p3_qrisk_lipids.png` (QRISK3, Total Cholesterol, HDL, LDL, Triglycerides)
  Front Desk reads all 3 image parts, packages them into `handoffPayload`, routes to `medical`, and triggers vision extraction.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-04.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Front Desk Triage:**
  ```json
  {
    "intent": "biomarker_review",
    "targetAgent": "medical",
    "status": "ready_for_handoff",
    "summaryForAgent": "Patient Alex (42yo male, mild hypertension) uploaded 3-page NHS GP lab report containing HbA1c, renal profile, liver function, full blood count, and lipid panel (Total Chol 6.5 mmol/L, HDL 1.5, Trig 1.7, LDL 4.3)...",
    "rawLabReport": "GP Lab Report - June 2026: HbA1c: 40 mmol/mol, Total Cholesterol: 6.5 mmol/L, HDL: 1.5 mmol/L, Triglycerides: 1.7 mmol/L, LDL: 4.3 mmol/L, QRISK2: 1.2%"
  }
  ```
* **Downstream Medical Vision Parser Execution:**
  - Gemini Vision parsed all 3 pages, extracting exact clinical values:
    - **Total Cholesterol:** `6.5 mmol/L`
    - **Calculated LDL:** `4.3 mmol/L`
    - **HDL Cholesterol:** `1.5 mmol/L`
    - **Triglycerides:** `1.7 mmol/L`
    - **HbA1c:** `40 mmol/mol`
  - **PII & Header De-Identification:** Verified 100% compliant (Zero sensitive surgery addresses, phone numbers, or government IDs echoed).
  - Score: **100/100** across terminology mapping, lossless unit preservation, and clinical guidance.

---

### UC-05: Conflicting & Unsafe Goal Disambiguation (CKD Stage 3 Crash Diet)
* **Scenario:** User with Stage 3 Chronic Kidney Disease (eGFR ~48) requests an extreme crash diet: losing 10kg in 10 days by eating only ribeye steak and drinking 4 whey protein shakes daily (~300g protein). Front Desk intercepts the physiological danger, blocks handoff, explains glomerular hyperfiltration risks, and re-questions the user. In Turn 2, user agrees to a safe plan, promoting handoff to Health Coach.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-05.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Turn 1 (`"crash diet and lose 10kg in 10 days... 300g protein"`):** Set `isDisambiguationRequired: true`, blocked handoff, explained renal risks.
* **Turn 2 (`"didn't realize high protein would overload my kidneys... let's follow the safe renal-friendly plan"`):** Cleared disambiguation, set `status: ready_for_handoff`, target `health_coach`.
* **Downstream Health Coach Execution:** Generated renal-protective plan: Sodium < 2000mg, moderate protein (115g–130g), gentle caloric deficit for 0.4 kg/week weight loss over 54 weeks.

---

### UC-06: Direct Health Status & Dietary Status Concierge
* **Scenario:** Alex asks: *"How is my sodium intake today affecting my blood pressure?"*
* **Context:** Active biomarkers: `blood_pressure: "134/86"`. Recent food logs: `Ramen (1850mg sodium)`.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-06.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Execution:** Answered directly from `<active_biomarkers>` and `<recent_food_logs>` without launching heavy external agents. Status: `needs_info` (informational mode), Target: `general_receptionist`, `handoffPayload: null`. Memory updated with salt intake observation.

---

### UC-07: Multi-Field Historical Mutation Engine (`modificationCommand[]`)
* **Scenario:** User notices errors in records: *"Yesterday's fasting glucose was actually 94 mg/dL not 104, and please delete the cuff error blood pressure reading of 220/120 from last Friday."*
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-07.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Execution:** Resolved `<system_current_date: 2026-09-03>`. Emitted `modificationCommand` array:
  1. `{ action: 'update_biomarker', keyName: 'fasting_glucose', date: '2026-09-02', newValue: '94', oldValue: '104', unit: 'mg/dL' }`
  2. `{ action: 'remove_biomarker', keyName: 'blood_pressure', date: '2026-08-28', oldValue: '220/120' }`
* Client in `LogChat.tsx` forwarded mutations directly to `onLogMedical`.

---

### UC-08: Multimodal Meal Logging & Mode D Comparison Relay
* **Scenario:** Multi-turn food orchestrator flow. In Turn 1, user asks to compare two meals (Chipotle chicken bowl vs Sweetgreen harvest bowl) against active LDL (151) and BP (134/86); Front Desk relays to `food_compare` (Mode D). In Turn 2, user uploads a photo of a home-cooked dinner plate asking to log it; Front Desk identifies the food photo, sets `targetAgent: food`, attaches image, and relays to the Food & Nutrition logging agent.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-08.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED (6,511ms)**
* **Turn 1 (Mode D Comparison):** Identified `compare_meal`, packaged dishes and cardiovascular markers (LDL 151, BP 134/86), set `targetAgent: food_compare`, status `ready_for_handoff`. Score: **100/100**.
* **Turn 2 (Meal Photo Logging Relay):** Identified food plate photo, mapped `intent: meal_logging`, set `targetAgent: food`, packaged image into `handoffPayload.images`, status `ready_for_handoff`. Score: **100/100**.

---

### UC-09: Scientific Literature Consensus Relay (PubMed / Agent 7)
* **Scenario:** User asks: *"What does the clinical literature say about Berberine vs Metformin for lowering HbA1c and does it cause GI distress?"*
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-09.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED**
* **Execution:** Front Desk identified `literature_review` intent. Packaged scientific topic and patient metabolic history into `handoffPayload.literatureTopic`. Routed to `targetAgent: agent7`. Status: `ready_for_handoff`.

---

### UC-10: Testing Agent Relay — Biomarker Gaps & Retest Schedule (Agent 4)
* **Scenario:** User asks: *"When should I retest my lipid panel, and what essential blood tests am I currently missing from my routine health checkups?"*
* **Context:** Active biomarkers: `total_cholesterol: 228`, `ldl: 151`, `hdl: 42`, `triglycerides: 175` (last checked 6 months ago). Overdue task: `Annual Comprehensive Metabolic & Lipid Panel`.
* **JSON Fixture:** `prototype/receptionist/benchmark/UC-10.json`

#### Live Execution Report:
* **Model:** `gemini-3.5-flash-lite` | **Status:** **100/100 PASSED (10,896ms)**
* **Front Desk Triage:**
  ```json
  {
    "intent": "test_planning",
    "targetAgent": "agent4",
    "status": "ready_for_handoff",
    "summaryForAgent": "The user (Alex, 42, male, mild hypertension) wants to know when to retest their lipid panel (last checked 6 months ago with LDL 151) and what essential or advanced blood tests are missing from routine checkups (such as ApoB, Vitamin D, and hs-CRP).",
    "actionableInsights": [
      "Lipid panel was last checked 6 months ago with an LDL of 151",
      "Patient has a medical history of mild hypertension",
      "Advanced markers like ApoB, Vitamin D, and hs-CRP have not been tested"
    ],
    "recommendedTasks": [
      {
        "id": "task_bio_01",
        "category": "biomarkers",
        "title": "Annual Comprehensive Metabolic & Lipid Panel",
        "status": "overdue"
      }
    ]
  }
  ```
* **Memory & Routing:** Set `conversationState: ready_for_handoff`, updated `workHistoryLog`, passed handoff to `agent4` (Test Planner).

---

## 4. Benchmark Runner Command Reference

To run any or all of the 10 canonical use cases against live Gemini models:

```bash
# Run all 10 canonical use cases
npx tsx prototype/receptionist/runner.ts --all

# Run specific use cases
npx tsx prototype/receptionist/runner.ts --case UC-01
npx tsx prototype/receptionist/runner.ts --case UC-04  # 3-Page NHS Vision Scan
npx tsx prototype/receptionist/runner.ts --case UC-10  # Testing Agent (Agent 4)
```
