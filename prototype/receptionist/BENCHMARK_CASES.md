# Receptionist & Onboarding Agent Benchmark Cases

## 1. Overview & Architecture

The **Receptionist / Onboarding Agent** serves as the intelligent conversational gateway of the Health Tracker application:
1. **Understands User Goals & Domain Logic**: Maps user intentions into scientific prerequisites for downstream specialized agents (e.g. Weight Loss $\to$ Calorie Deficit $\to$ requires Age, Gender, Height, Weight, Activity, Medical history).
2. **Maintains & Consolidates Persistent Memory (`memory`)**: Every turn reads incoming `existingMemory` and `existingUserProfile`, reconciles newly supplied facts from chat messages, and updates a consolidated `memory` structure.
3. **Identifies Missing Information**: If critical fields are missing, sets status to `needs_info`, leaves `handoffPayload` null, and prompts the user conversationally with clear rationale.
4. **Packages Downstream Handoff Payload**: Once all necessary data is gathered (or for existing users with full profiles), compiles a rich `handoffPayload` for the `coach` or specialist agent and marks status as `ready_for_handoff`.

---

## 2. Benchmark Case Summaries

| Case | Title | User Input | State & Profile | Target Agent | Expected Status | Key Evaluation Criteria |
|---|---|---|---|---|---|---|
| **C1** | New User Weight Loss | `"I want to loose weight"` | Empty profile / No memory | `health_coach` | `needs_info` $\to$ `ready_for_handoff` | Multi-turn onboarding: collects calorie deficit inputs (gender, age, height, weight, activity, medical); consolidates memory; triggers existing Health Coach agent for MSJ BMR, macro targets, and habit tasks. |
| **C2** | New User General Wellness | `"i just want to be healthy"` | Empty profile / No memory | `health_coach` | `needs_info` | Identifies broad wellness intent; identifies missing pillars (focus areas, lifestyle, activity, demographics); initializes memory; asks user for clarification. |
| **C3** | Existing User Health Improvement | `"What can be improved for my health?"` | Full profile (Alex, 42M, 178cm, 82kg) + history | `health_coach` | `ready_for_handoff` | Confirms profile is complete; detects overdue annual biomarker panel & inconsistent nutrition logs; consolidates memory; packages `handoffPayload` for existing Health Coach. |

---

## 3. Case Detail: C1 (New User Weight Loss Multi-Turn Onboarding)

### Progression Flow:
1. **Turn 1 (Goal Expression)**:
   - User: `"I want to loose weight"`
   - Receptionist recognizes `weight_loss` goal requiring a calorie deficit.
   - Identifies missing required physiological metrics: `gender`, `age`, `height`, `weight`, `medical_history`.
   - Initializes memory with `conversationState: "onboarding_gather_info"` and explains why the metrics are required.
   - Status: `needs_info`, `handoffPayload: null`.
2. **Turn 2 (Partial Information Provided)**:
   - User: `"I'm a 32-year-old male, 180cm tall. No major medical conditions."`
   - Receptionist reads previous memory, consolidates `age: 32`, `gender: "male"`, `heightCm: 180`, `medicalHistory: []`.
   - Identifies remaining missing blocker: `weight` (required to compute BMR & starting deficit).
   - Status: `needs_info`, `handoffPayload: null`. Prompts for current weight and target weight.
3. **Turn 3 (Complete Information & Downstream Handoff)**:
   - User: `"My current weight is 92kg and my target is 80kg. I have a sedentary desk job with light daily walking."`
   - Receptionist consolidates `weightKg: 92`, `targetWeightKg: 80`, and `activityLevel`.
   - With all required data present, updates state to `ready_for_handoff` and constructs a rich `handoffPayload` for the Coach agent (enabling Mifflin-St Jeor BMR calculation and structured caloric deficit planning).

---

## 4. Case Detail: C2 (New User General Wellness)

### Input Payload
```json
{
  "currentUserMessage": "i just want to be healthy",
  "chatHistory": [
    { "role": "user", "content": "i just want to be healthy" }
  ],
  "existingUserProfile": null,
  "existingMemory": null,
  "existingActivitiesAndTasks": null
}
```

### Expected Output Structure
- `intent`: `"general_wellness"`
- `targetAgent`: `"coach"`
- `status`: `"needs_info"`
- `missingFields`: `["age", "gender", "primary_focus_areas", "activity_level", "lifestyle_habits", "medical_history"]`
- `memory.goalSummary`: `"User wants to improve overall health, vitality, and general wellness."`
- `memory.conversationState`: `"onboarding_gather_info"`
- `userResponse`: Welcomes the user, asks what health pillars they'd like to prioritize (energy, sleep, diet, fitness), and requests basic age/gender/routine details.
- `handoffPayload`: `null`

---

## 5. Case Detail: C3 (Existing User Improvement Review)

### Input Payload
```json
{
  "currentUserMessage": "What can be improved for my health?",
  "chatHistory": [
    { "role": "user", "content": "What can be improved for my health?" }
  ],
  "existingUserProfile": {
    "name": "Alex",
    "age": 42,
    "gender": "male",
    "heightCm": 178,
    "weightKg": 82,
    "activityLevel": "moderately_active",
    "medicalHistory": ["mild hypertension"],
    "dietaryPreferences": ["mediterranean-leaning"],
    "targetWeightKg": 78
  },
  "existingMemory": {
    "goalSummary": "Maintain cardiovascular wellness, gradual fat loss to 78kg.",
    "userProfileSnapshot": { ... },
    "conversationState": "ongoing_support",
    "pendingItems": [],
    "keyInsights": ["User maintains consistent weekly strength workouts but has sporadic nutrition logging."]
  },
  "existingActivitiesAndTasks": [
    {
      "id": "task_bio_01",
      "category": "biomarkers",
      "title": "Annual Comprehensive Metabolic & Lipid Panel",
      "status": "overdue",
      "lastCompleted": "2025-06-10"
    },
    {
      "id": "task_nut_02",
      "category": "nutrition",
      "title": "Daily Meal & Micronutrient Logging",
      "status": "inconsistent"
    },
    {
      "id": "task_fit_03",
      "category": "fitness",
      "title": "3x Weekly Resistance Training",
      "status": "completed_on_track"
    }
  ]
}
```

### Expected Output Structure
- `intent`: `"health_improvement"`
- `targetAgent`: `"coach"`
- `status`: `"ready_for_handoff"`
- `missingFields`: `[]`
- `memory.conversationState`: `"ready_for_handoff"`
- `userResponse`: Highlights overdue annual biomarker lab test, reminds about meal logging consistency for blood pressure/sodium, praises strength training consistency, and triggers handoff.
- `handoffPayload`: Complete handoff object with `actionableInsights`, `consolidatedUserProfile`, and `consolidatedMemory`.
