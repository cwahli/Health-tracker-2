/**
 * F-8.10 shard 5 — mode routing + apiCalls ledger, extracted verbatim from
 * runFoodAnalyze. Pure decisions; the caller keeps early-returns and logging
 * flows through the injected onLog callback.
 */

export interface FoodModeArgs {
  rawMode?: string;
  originalModeIsModify: boolean;
  userSelectedMode?: string;
  visionScoutItemCount?: number;
  hasActiveMealDocument: boolean;
  editCommandCount: number;
  onLog: (msg: string) => void;
}

/**
 * Resolves the response mode. Mirrors the inline order: explicit mode first,
 * single-item evaluation demotion, modify forcing, then the post-evaluation
 * edit-command override (which never applies to discussion/evaluation —
 * those return before it in the caller).
 */
export function resolveFoodAnalyzeMode(args: FoodModeArgs): string {
  const {
    rawMode,
    originalModeIsModify,
    userSelectedMode,
    visionScoutItemCount,
    hasActiveMealDocument,
    editCommandCount,
    onLog,
  } = args;
  let mode = rawMode || (originalModeIsModify ? "modify" : "new_log");
  // Mirrors the inline guard: a missing scout list never demotes evaluation.
  if (userSelectedMode !== 'compare' && (visionScoutItemCount ?? 2) <= 1 && mode === "evaluation") {
    onLog(`[Mode Override] Overriding mode from 'evaluation' to 'new_log' because only 1 item was identified.`);
    mode = "new_log";
  }
  if (originalModeIsModify && mode !== "discussion" && mode !== "evaluation") {
    mode = "modify";
  }
  if (mode !== "discussion" && mode !== "evaluation") {
    if (editCommandCount > 0) {
      mode = "modify";
    }
    if (originalModeIsModify && hasActiveMealDocument) {
      mode = "modify";
      if (editCommandCount === 0) {
        onLog(`[Single-Path] Same meal, empty modificationCommand — Q&A (card unchanged). Not a new meal.`);
      } else {
        onLog(`[Single-Path] Same meal, ${editCommandCount} edit command(s).`);
      }
    }
  }
  return mode;
}

export interface FoodApiCallsArgs {
  hasImage: boolean;
  queriesToSearch: any;
  canSkipDietitianForCreate: boolean;
  canSkipDietitianForPureScale: boolean;
  engine: any;
}

export function buildFoodApiCalls(args: FoodApiCallsArgs): Array<{ type: string; label: string }> {
  const { hasImage, queriesToSearch, canSkipDietitianForCreate, canSkipDietitianForPureScale, engine } = args;
  return [
    ...(hasImage ? [{ type: 'gemini', label: 'Food nutrition agent - Visual Scout (gemini-3.5-flash-lite)' }] : []),
    ...(queriesToSearch && queriesToSearch.length > 0 ? [{ type: 'usda', label: `Food nutrition agent - USDA (${queriesToSearch.length})` }] : []),
    ...((canSkipDietitianForCreate || canSkipDietitianForPureScale) ? [] : [{ type: 'gemini', label: `Food nutrition agent - Dietitian (${(typeof engine === 'object' ? engine?.name || engine?.model : engine) || 'gemini-3.5-flash-lite'})` }])
  ];
}
