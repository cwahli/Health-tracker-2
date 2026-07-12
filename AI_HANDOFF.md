# AI Handoff Log — Health Tracker App

**Purpose:** This file is the shared memory across AI sessions working on this app — Claude (diagnosis/planning, writes instructions) and Gemini/AI Studio (implementation). Read this file fully before making changes. When you finish meaningful work, append to the Changelog and update Next Steps — don't delete history.

## What this app does
A personal health tracker (food logging, biomarker tracking, AI-driven diagnostics) built as a Google AI Studio app, deployed on Cloud Run, using Firestore (free tier) for storage and the Gemini API for all AI features. Single owner/user, not a multi-tenant product.

## Hard constraints — do not violate these
- Firestore is on the free tier. Minimize reads/writes. Never add a new Firestore read/write without a clear reason.
- Gemini quota is limited and tiered: gemini-3.1-flash-lite has a much larger daily quota (~500/day) than any other model (~20/day: gemini-3.5-flash, gemini-3.1-pro-preview, etc). Default to flash-lite for everything. Only use a higher tier model for a specific, demonstrated reason — and prefer fixing the root cause over routing around it with a pricier model.
- Don't break existing patches. This codebase has deliberate workarounds for past bugs (see "Fragile areas" below). Understand why something exists before changing code near it.
- Keep changes small and isolated, and verify before building further. Large "also improve X while you're at it" sessions have previously caused big unplanned diffs that introduced new bugs. Do exactly what was asked, nothing more. After every session, diff against the last known-good commit before trusting it.

## Architecture map
- server.ts — Express backend, all Gemini API calls, all prompt construction.
- server_food_db.ts — small hardcoded fallback nutrition table (FOOD_DATABASE, getNutrientsForFood), used only when neither a USDA/OFF match nor a label reading is available. Crude substring matching — known to false-positive (e.g. "milk chocolate" matched "milk"). Low priority since label/dbId paths now take precedence for photographed items.
- src/App.tsx — top-level React state/orchestration. Contains a read-time guard that auto-recompresses any stored image over ~25,000 characters back to 400x400/0.5 quality, to protect Firestore's 1MB document limit. Do not remove this.
- src/components/LogChat.tsx — chat UI for Food Log, Home food locator, daily recommendation. Most fully-featured chat surface; reference implementation for consolidation.
- src/components/ReviewBiomarkerModal.tsx — Medical History review chat. Also fully-featured.
- src/components/BiomarkerDictionaryModal.tsx — 4 cleaning agents (standardize units, medical categorization, data accuracy, name consolidation). Has the instruction viewer but not the log viewer. Has biomarker pre-selection checkboxes feeding directly into the agent — must be preserved in consolidation.
- src/components/InsightsTab.tsx — Diagnostic tab, 5 agents + "run health analysis." Uses its own bespoke result UI (AgentResultViews.tsx, AgentResultTable.tsx), not the shared viewers. Biggest remaining consolidation work, deliberately saved for last.
- src/components/FullScreenInstructionViewer.tsx / FullScreenLogViewer.tsx — shared UI components already reused by LogChat, ReviewBiomarkerModal, BiomarkerDictionaryModal (instruction viewer only), Header. Not yet used by InsightsTab.

## The 12-agent consolidation project (overall goal)
Every agent-chat surface (food log, food locator, 5 diagnostic agents, medical history review, 4 biomarker-dictionary cleaning agents) should share one framework: chat history with per-item/bulk delete, multi-format answers reconciled with backend-computed values, continue/update conversation, a "data used by agent" dropdown, a log viewer working across multiple agents/conversations (tabs + dropdown), and a dynamic/editable instruction viewer with variable-level editing — while keeping each agent's unique features.

Planned phase order: 1) Fix Food Log data-accuracy bugs (in progress) -> 2) Biomarker Dictionary parity -> 3) InsightsTab consolidation -> 4) New shared features layered on top (log tabs, instruction variable editing, generalized checkbox pre-selection).

## Food log pipeline — current state
- Images: two compressed copies per image. A 400x400/0.5-quality copy for chat thumbnails and Firestore storage. A separate ~1280px/0.85-quality copy generated fresh from the original file, sent only in the transient Gemini request, never persisted. Keep these separate.
- Nutrient computation priority in the itemsBreakdown mapping loop (server.ts): dbSource "label" + labelNutrientsPerServing (highest priority, scaled to actual weight) > USDA/OFF dbId match > getNutrientsForFood fallback table.
- The AI's prose (message/risks/healthImpact) and the structured/computed numbers are separate pipelines that can drift out of sync. A "CONSISTENCY REQUIREMENT" prompt directive asks the model to keep them aligned, but it's a nudge, not an enforced constraint.
- Output format is Gemini's native structured-output JSON mode (foodAnalyzeSchema in server.ts), replacing an earlier free-form YAML approach. Includes a free-text scratchpad field for chain-of-thought before the structured fields.

## Changelog
1. Fixed: food images were compressed to 400x400/50%-quality before AI analysis (same copy for storage+display+analysis), making labels unreadable. Fixed with the dual-resolution pipeline above.
2. Fixed: prompt only handled a single generic image, didn't tell the model to expect/prioritize a label among multiple images. Added explicit multi-image/label-detection instructions.
3. Fixed (the big one): even when the model read a label correctly, that data was discarded — displayed/computed numbers came from a USDA/OFF match or the crude fallback table, never from the label. Added dbSource "label" + labelNutrientsPerServing to the schema, prioritized above USDA/OFF and the fallback table. Verified intact after later refactors.
4. Unplanned, discovered after the fact: output format was also switched from YAML to Gemini's native JSON structured-output mode, and a scratchpad reasoning field was added. Not explicitly requested, kept anyway — schema-constrained output is generally more reliable than free-form YAML.
5. Diagnosed: gemini-3.1-flash-lite can get stuck in a runaway digit-repetition loop generating a NUMBER-type field (seen on weightGrams), producing truncated, unparseable JSON. User sees a generic "agent not available" message when this happens.
6. Added: maxOutputTokens cap, extractBalancedJson repair before parsing, retry-once on parse failure.
7. Learned: retrying with the identical model can reproduce the identical failure (seen twice in a row on the same request). Rejected escalating the retry to a non-lite model — burns the ~20/day quota tier, not sustainable.
8. Root-cause fix attempted: changed NUMBER-typed schema fields most implicated (weightGrams variants, newWeightGrams, labelNutrientsPerServing fields) to STRING type, parsed with Number()/parseFloat afterward. Zero extra API cost, unlike a model-fallback retry.
9. Cleaned up throwaway Python/JS patch scripts a previous session had left committed in the repo root.
10. Learned: The NUMBER->STRING schema change (from #8) did NOT resolve the issue. The model simply shifted the runaway repetition from numbers to text inside the string. It started hallucinating a massive wall of text (including endless "No. No. No." loops) directly *inside* the `weightGrams` string value, causing an "Unterminated string in JSON" error.
11. Learned: Removing the `scratchpad` field (under the hypothesis that it was confusing the model between free-form reasoning and strict structured output) also failed. The model just dumped its unconstrained reasoning directly into the `weightGrams` field instead.
12. Conclusion on the bug: The issue is a systemic context-window or schema-alignment breakdown specific to `gemini-3.1-flash-lite` for this complex prompt. It loses structural discipline right when it reaches the `weightGrams` field (the first data field after the core strings). All structural mitigations (schema types, token limits, removing scratchpads, retries) have failed to prevent the hallucination loop.

## Known open issues (need a fresh repro log if they recur)
- `gemini-3.1-flash-lite` continues to fail consistently with unterminated JSON (runaway text/digits inside `weightGrams`) when logging foods.
- "Update food entry" (MODE C/modify) was reported as miscalculating, prior to the label/dbSource fix (#3). The modify math itself (proportional rescaling of each item's stored numbers, then re-summing totals) was reviewed directly and looks sound. Best guess: it was inheriting already-wrong base numbers from the bug fixed in #3, not a bug in the modify logic — unconfirmed since that fix landed. Get a debug log before assuming anything if it recurs.

## Next steps queue (priority order)
1. Since structural schema changes failed to fix the `weightGrams` JSON bug, the next mitigation to try is setting `temperature: 0.1` (or 0) in the `model.generateContent` config for `callAndParseFoodAnalysis`. This might reign in the runaway hallucination loops.
2. If temperature lowering fails, we may need to radically simplify the JSON schema, break the prompt into two simpler chained calls (one for data extraction, one for clinical prose), or reconsider the model routing if `flash-lite` simply cannot handle the schema complexity.
3. Get a fresh log for "update food entry" if it happens again.
4. Bring Biomarker Dictionary up to parity (add log viewer + "data used by agent" block).
5. Migrate InsightsTab's 5 diagnostic agents onto the shared viewer components.
6. Build the new consolidation features (cross-agent log tabs/dropdown, editable instruction variables, generalized checkbox pre-selection).
