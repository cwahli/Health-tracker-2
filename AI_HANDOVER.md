# Health Cockpit App — AI Handover Document
*Last updated: 2026-07-12 | Always check GitHub commits before starting any session*
## 1. Source of Truth
- **Live codebase:** https://github.com/cwahli/Health-tracker-2
- **Always read the latest commits** before working. The AI Studio agent is self-directed and may have progressed since this doc was last written.
- **This document lives in the repo root** as `AI_HANDOVER.md` and must be updated after each significant session.
---
## 2. Architecture
| Layer | Tech | Notes |
|---|---|---|
| Frontend | React (TypeScript) | `applet/src/` |
| Backend | Express (TypeScript) | `applet/server.ts` (~4000+ lines) |
| Database | Firebase Firestore | Free tier — minimize reads/writes |
| Auth | Firebase Auth | Google sign-in |
| AI | Gemini via @google/genai SDK | See quota table below |
| Hosting | Firebase App Hosting | Cloud Run |
---
## 3. AI Models & Quotas
| Model ID (in code) | Friendly Name | Daily Quota | When to Use |
|---|---|---|---|
| gemini-3.5-flash-lite | Flash Lite | 500 calls/day | ALL routine tasks (default) |
| gemini-3.5-flash | Flash | 20 calls/day | Moderate complexity |
| gemini-3.1-pro | Pro | 20 calls/day | Complex, architectural |
There is NO gemini-2.5-flash. Always default to Flash Lite.
---
## 4. Operating Rules
- Read this document at the start of every session.
- Execute the next unchecked item in Section 7 (Task Queue).
- Commit changes to GitHub with a meaningful commit message.
- Update this document with what you did and tick off completed tasks.
- Never undo existing fixes — all prior patches are intentional.
- Never delete user data (biomarkers, food logs, targets).
- Never add extra Firebase reads/writes — free tier has limits.
- Never change agent model IDs without explicit instruction.
---
## 5. Key Components
### Server (applet/server.ts)
- `callUnifiedLLM()` — central LLM dispatcher. Params: modelId, systemInstruction, promptText, imagePayloads, responseMimeType, maxOutputTokens.
- `sanitizeForFirestore()` — deep-cleans undefined fields before any Firestore write. Applied to all writes.
- Food log endpoint pipeline:
  - Stage 1: Vision Scout (image-only, identifies food keywords via lightweight LLM)
  - Stage 2: DB Search (USDA + OpenFoodFacts using Vision Scout keywords)
  - Stage 3: RouteAgent (full clinical dietitian JSON response, 4 modes: new_log / discuss / modify / evaluation)
  - JSON parse with truncation repair fallback.
- maxOutputTokens: 2048 is set on the RouteAgent call to prevent truncation.
### Frontend
- `applet/src/components/LogChat.tsx` — chat component used by food log agent.
- `applet/src/components/FoodHistoryTab.tsx` — food log history.
- `applet/src/App.tsx` — main app, auth, data loading, local snapshot/undo system.
### Chat Session Storage
- Conversation history is stored in sessionStorage (per-session) as primary.
- Firestore is the durable backup for history.
- Local snapshots (up to 5) in localStorage for undo. Base64 images stripped.
---
## 6. What Has Been Fixed (Do Not Undo)
| Date | Fix |
|---|---|
| Jul 11 | useRef missing import in App.tsx causing blank screen |
| Jul 11 | firebase-admin ESM import fixed |
| Jul 12 | maxOutputTokens: 2048 added to RouteAgent LLM call |
| Jul 12 | Truncation repair fallback for malformed JSON |
| Jul 12 | sanitizeForFirestore() applied to all Firestore writes |
| Jul 12 | MODE C (modify) routing strengthened in system prompt |
| Jul 12 | weightGrams schema updated — integer strings only, no decimals |
| Jul 12 | Biomarker deletion safeguards added |
| Jul 12 | LLM output switched from YAML to JSON for reliability |
| Jul 12 | Firestore security rules restricted to user-specific paths |
| Jul 12 | Biomarker review endpoint implemented |
---
## 7. Task Queue
Pick the first unchecked item. Complete it. Tick it off. Update Section 9 (Session Log).
### P0 — Critical
- [x] **Fix B: Skip Vision Scout + DB search on weight-only modifications**
  When activeMeal is set AND no new image is attached AND user message matches /\d+\s*g(ram)?s?/i, skip Vision Scout and DB Search entirely and jump straight to RouteAgent. DB search must NEVER use the raw user message text as a search query — only Vision Scout keywords.
  Model: gemini-3.5-flash
- [x] **Fix: Server-Side Nutrition Calculation (Accurate Calories/Nutrients)**
  Simplified LLM's `new_log` schema for `itemsBreakdown` by removing direct nutrient requirements from prompt text unless `dbSource === 'label'`. The backend computes and aggregates nutrients dynamically from standard DB matches or high-precision local database.
  Model: gemini-3.5-flash
### P1 — Important
- [x] **Fix: Food log card weight not updating after modify response**
  When RouteAgent returns mode "modify" with modificationCommand, the frontend (LogChat.tsx) must apply the weight change to the active meal card display and recalculate nutrient display. Currently the card shows the original weight even after correction.
  Model: gemini-3.5-flash
- [x] **Fix: Verify chat session scratchpad uses sessionStorage**
  Verified that conversation history is saved to sessionStorage for unauthenticated users. Refactoring required for authenticated users to use sessionStorage as primary store, currently writes to Firestore on every message.
  Model: gemini-3.5-flash-lite
### P2 — Future
- [ ] **Verify food log card layout has no tab switcher regression**
  The correct layout is: card (meal name, date, nutrients) + collapsible nutrition table. There must be NO Prose/Table/Bento tab switcher on the food log chat. Check the current state first. Only fix if the regression is present.
  Model: gemini-3.5-flash-lite
- [ ] **Expand chat component to all 13 agents**
  LogChat.tsx will serve all agents. Add an agentConfig object keyed by agentType to declare per-agent layouts. Do not implement until food log is fully stable.
  Model: gemini-3.5-flash
---
## 8. Open Decisions
- Scratchpad: sessionStorage as primary, Firestore as backup. Keep it. Confirmed 2026-07-12.
- Food log layout: card + collapsible table. No tab switcher. Confirmed 2026-07-12.
- DB search on modify: skip entirely. Only run on new image or fresh food description. Confirmed 2026-07-12.
---
## 9. Session Log
| Date | What was done | By |
|---|---|---|
| 2026-07-11 | Fixed blank screen (useRef, firebase-admin). App loads again. | Antigravity + AI Studio |
| 2026-07-12 | Fixed JSON truncation, Firestore undefined error, MODE C routing, weightGrams schema, biomarker review endpoint. 13 commits. | AI Studio (self-directed) |
| 2026-07-12 | Created this handover document. Identified remaining P0/P1 tasks. | Antigravity |
| 2026-07-12 | Verified session storage behavior for chat. | AI Studio (self-directed) |
| 2026-07-12 | Implemented Fix B: Skip Vision Scout and DB search on weight-only modifications, ensuring DB search only uses Vision Scout keywords. | AI Studio (self-directed) |
| 2026-07-12 | Implemented Server-Side Nutrition Calculation, simplifying the LLM output schema for itemsBreakdown. | AI Studio (self-directed) |
| 2026-07-12 | Completed Step 2 (exact server-side nutrient lookup & kJ conversion), Step 3 (system prompt log reduction), and Step 4 (Vision Scout itemsBreakdown truncation fallback). | AI Studio (self-directed) |
| 2026-07-12 | Fixed food log card display not updating on weight modification (implemented mode: modify on server & setMessages reactivity on frontend). | AI Studio (self-directed) |
