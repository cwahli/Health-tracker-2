# AI Handoff Log — Health Tracker App

**Purpose:** This file is the shared memory across AI sessions working on this app — Claude (diagnosis/planning, writes instructions) and Gemini/AI Studio (implementation). Read this file fully before making changes. When you finish meaningful work, append to the Changelog and update Next Steps — don't delete history.

## What this app does
A full-stack health tracking web app (React + Express + Firebase/Firestore). 
- **GitHub:** https://github.com/cwahli/Health-tracker-2
- **Local Dev:** /Users/chiwah/Downloads/biomarker-and-nutrient-tracker/
- **Storage:** Firestore (free tier — minimize reads/writes)
- **AI features:** Gemini models via @google/genai SDK (gemini-3.5-flash-lite, gemini-2.5-flash, gemini-3.1-pro)

## Hard constraints — do not violate these
- **Firestore:** Free tier. Minimize reads/writes. Never add a new Firestore read/write without a clear reason.
- **AI Models:** Gemini quota is limited and tiered.
  - gemini-3.5-flash-lite: ~500 calls/day (default for all routine tasks)
  - gemini-2.5-flash: ~20 calls/day
  - gemini-3.1-pro: ~20 calls/day
  - Default to flash-lite. Only use a higher tier model for a specific, demonstrated reason — and prefer fixing the root cause over routing around it with a pricier model.
- **Do NOT:**
  - Delete biomarker data.
  - Undo past bug fixes (check git history if unsure).
  - Add extra Firestore reads/writes.
  - Change the agent model IDs (quota is limited).

## Architecture map
- server.ts — Express backend, all Gemini API calls, all prompt construction (~4600 lines).
- src/App.tsx — top-level React state/orchestration. Includes a read-time guard that auto-recompresses any stored image over ~25,000 characters back to 400x400/0.5 quality, to protect Firestore's 1MB document limit. Do not remove this.
- Layout Rule: Food log must be a card + collapsible nutrition table. No tabset/tabs in the log. Design pattern for other agents (12 total) to be standardized based on this.

## Known open issues
1. "Update food entry" (MODE C/modify) was reported as miscalculating, prior to the label/dbSource fix (#3). The modify math itself (proportional rescaling of each item's stored numbers, then re-summing totals) was reviewed directly and looks sound. Best guess: it was inheriting already-wrong base numbers from the bug fixed in #3, not a bug in the modify logic — unconfirmed since that fix landed. Get a debug log before assuming anything if it recurs.
2. UI shows Prose/Table/Bento tabs on food log — should be card only.

## Changelog
... [Keep existing changelog items 1-17] ...

## Next steps queue (priority order)
1. [x] Verify the newly implemented 3-stage JSON truncation cleanup, decimal prompt-instruction restrictions, and modification shortcuts completely resolve the repeatable `weightGrams` issues and redundant calls.
2. Bring Biomarker Dictionary up to parity (add log viewer + "data used by agent" block).
3. Migrate InsightsTab's 5 diagnostic agents onto the shared viewer components.
4. Build the new consolidation features (cross-agent log tabs/dropdown, editable instruction variables, generalized checkbox pre-selection).
5. Standardize UI for agents to match Food Log card layout (remove unnecessary tabs).
