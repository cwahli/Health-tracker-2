# Inline Branded Catalog Tagging Plan

**Date:** 2026-08-28
**Status:** Planned / Pending Implementation
**Feature:** Auto-detect branded catalog foods during chat input, allowing users to insert structured food tags with specific portion sizes directly into the chat line. These tagged items bypass the Vision Scout and inject deterministically into the backend meal builder.

## 1. Core Objectives
- **Frictionless Catalog Lookup:** Auto-search the database while the user types, specifically triggering when a brand name + food name pattern is detected.
- **Portion Awareness:** Auto-extract grammatical quantities (e.g., "70g", "2 servings") from the typed text to prepopulate the dropdown's portion input.
- **Rich Inline Tags:** Convert selected catalog items into interactive inline tags (e.g., `[Mr oat rolled oat 70g]`) within the chat input that can be tapped to edit or deleted.
- **Scout Bypass (First-Principles Injection):** Send the tagged items directly to the backend as structured data, skipping the Gemini Vision Scout hallucination risk and going straight to the Dietitian/Ledger.

## 2. Architecture & Components

### A. Frontend: Chat Composer Upgrades
1. **Rich Input / ContentEditable:**
   - Standard `<textarea>` does not support tappable inline HTML nodes.
   - **Migration:** Convert the `LogChat` input to a controlled `contenteditable` `div` (or use a lightweight wrapper) that allows rendering custom span tags for the pills.
   - **Tag Data Structure:** Maintain a React state array of `activeTags: Array<{ id: string, name: string, dbId: string, weightGrams: number }>` linked to the UI pills.

2. **Debounced Search & Quantity Regex:**
   - Watch the cursor position and current word boundary.
   - If a brand-like phrase is detected (e.g., typing "Mr oat"), trigger a debounced `GET /api/food/search` scoped to branded/custom items.
   - **Quantity Regex:** Run `/\b(\d+(?:\.\d+)?)\s*(g|ml|oz|servings?)\b/i` on the 3-4 words preceding the cursor to pre-fill the portion size.

3. **Dropdown UI Enhancements:**
   - Re-use the existing "Previous Meals / Suggestions" popup component.
   - When matches `< 3`, display them.
   - Inject a quick numeric input inside the dropdown row: `[ 70 ] g | Add`.

### B. Backend: Payload & Pipeline Integration
1. **API Payload Modification (`POST /api/food/analyze`):**
   - Add a new array to the payload: `explicitFoodTags: [{ dbId, name, weightGrams, brand, source: 'catalog_tag' }]`.
   
2. **Vision Scout Bypass (`server_routes_food_analyze.ts`):**
   - When the backend receives `explicitFoodTags`, it parses them immediately into the `visionScoutItems` / `preCalculatedItems` arrays BEFORE the Dietitian stage.
   - These items are marked with a flag (e.g., `isExplicitTag: true`) so they are mathematically resolved using their exact DB values without going through the LLM vision prompt.
   - The LLM Vision Scout is either skipped entirely (if no images are present) or runs ONLY on the images to find *other* items, while ignoring the text that was already converted to tags.

## 3. Edge Cases & Constraints
- **Tag Deletion:** If the user presses Backspace at the end of a tag, it should highlight the whole tag, and a second Backspace deletes it (standard rich-text pill behavior), simultaneously removing it from the `activeTags` state.
- **Mobile Interaction:** Tapping a tag on mobile should open a small popover or modal to quickly edit the `weightGrams` or remove the item.
- **Text Sync:** The prompt sent to the LLM (for the Dietitian or remaining Scout work) should replace the visual HTML tags with clean text like `"I had {Mr Oat Rolled Oats (70g)}"` so the agent understands the context.
- **Performance:** The catalog search must be heavily debounced (e.g., 400ms) and cached locally to prevent spamming the database on every keystroke.

## 4. Implementation Phasing
- **Phase 1:** Upgrade the chat input to support `contenteditable` inline tags and the state management for `activeTags`.
- **Phase 2:** Implement the debounced backend search, quantity regex extractor, and the enhanced dropdown UI.
- **Phase 3:** Update the `analyze` endpoint to intercept `explicitFoodTags` and inject them into the `preCalculatedItems` mathematical ledger.
