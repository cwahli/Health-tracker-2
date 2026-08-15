export type StudioNextKind = 'new_analyze' | 'accept' | 'follows' | 'replay' | 'other';

export type StudioNext = {
  next: string;
  note: string;
  /** One line for the human sitting in the inbox. */
  youDo: string;
  kind: StudioNextKind;
};

/**
 * Tell Studio *how* to clear a red — log replay vs new scout vs accept.
 * Prevents agents from claiming COMPLETE after Replay log when Scout must re-run.
 */
export function classifyStudioRed(id: string, label: string): StudioNext {
  const blob = `${id} ${label}`.toLowerCase();
  if (/label_merge|merged into/.test(blob)) {
    return {
      next: 'NEW Analyze with the original photos after server restart. Replay log / pipeline cannot un-merge a frozen scout.',
      note: 'Code: canMergeScoutLabelIntoFood in server_vision_scout.ts. Do not change expected kcal.',
      youDo: 'You: click NEW Analyze on this card (saved photos + query). Do not re-upload. Do not Replay log.',
      kind: 'new_analyze',
    };
  }
  if (/weight_anchor|overwrote|500.*1000/.test(blob)) {
    const lassi = /lassi|500\s*ml|1\s*l\b/.test(blob);
    return {
      next: lassi
        ? 'Replay log stays red (original tape). Pipeline inherits frozen scout weights. NEW Analyze with the same photos + “Lassi is 500ml the other is 1L”. Lassi should be ~500g, not 1000g. The 335 kcal / 1000g line is the buggy snapshot.'
        : 'Replay log stays red (original tape). Pipeline inherits frozen scout weights. NEW Analyze with the same photos and the original typed text.',
      note: 'Code: claimedItems in resolvePackageAndContextItems. Do not “fix” by editing expected numbers.',
      youDo: 'You: click NEW Analyze on this card (saved photos + the original typed text).',
      kind: 'new_analyze',
    };
  }
  if (/kept the label/.test(blob)) {
    return {
      next: 'Guardrail worked. Printed kcal stayed; the DB hit was refused.',
      note: '',
      youDo: 'You: nothing. This is not a remaining bug.',
      kind: 'accept',
    };
  }
  if (/truth_merge|246.*102|150.*102/.test(blob)) {
    return {
      next: 'Search vs printed label. Fail only if 102 landed on Serrano (or the right dish is missing). If Ham is present at ~102, Replay log — the refuse was correct.',
      note: 'Truth-merge refused a DB hit. Do not accept the OCR number onto the wrong food.',
      youDo: 'You: Replay log. If Ham is on the board at ~102 kcal, this should go green.',
      kind: 'follows',
    };
  }
  if (/estimated_macros|ingredient_decomposition|derived from base food/.test(blob)) {
    return {
      next: 'Printed kcal locked; P/C/F (and micros) derived from base food scaled to that kcal. That is the intended path — verify it ran, do not hunt printed macros.',
      note: 'Do not invent a full printed panel. Do not change expected kcal.',
      youDo: 'You: nothing. This is how a kcal-only shelf tag is supposed to work.',
      kind: 'accept',
    };
  }
  if (/empty_foodlog|scout_items_present/.test(blob)) {
    return {
      next: 'Replay log. Compare mode must keep itemsBreakdown (not foodData=null).',
      note: 'Snapshot/UI shape — dishes were computed; extractFoodItems missed comparison groups.',
      youDo: 'You: Replay log after restart. If dishes are already listed above, this is leftover.',
      kind: 'replay',
    };
  }
  if (/brandguard|generic token: sugar|not a brand/.test(blob)) {
    return {
      next: 'Replay log / pipeline after restart. “sugar” is never a brand.',
      note: 'isKnownDatabaseBrandSync deny list.',
      youDo: 'You: Replay log after restart. If sugar already shows as Printed / brand truth, ignore.',
      kind: 'replay',
    };
  }
  if (/missing item/.test(blob) && /presence/.test(blob)) {
    return {
      next: 'Identity: dish must appear. New scout if Label Merge ate it. Do not invent kcal.',
      note: '',
      youDo: 'You: click NEW Analyze on this card if a food disappeared into another dish. Do not type a fake kcal.',
      kind: 'new_analyze',
    };
  }
  return {
    next: 'Replay log if the check is unfair. Pipeline if resolve/search changed. New Analyze if scout JSON is already wrong.',
    note: 'Never change expected meal numbers. Never claim COMPLETE without Replay saying green.',
    youDo: 'You: Replay log first. If the tape is already the bug, NEW Analyze.',
    kind: 'other',
  };
}

export type LoopRedClass = 'accept' | 'new_analyze' | 'pipeline';

/** What the skipScout loop can do with this red. */
export function loopRedClass(
  id: string,
  label: string,
  ctx?: { hasLabelMerge?: boolean; alreadyAnalyzed?: boolean }
): LoopRedClass {
  const k = classifyStudioRed(id, label).kind;
  if (k === 'accept') return 'accept';
  if (k === 'follows') return ctx?.hasLabelMerge ? 'new_analyze' : 'pipeline';
  if (k === 'new_analyze') return 'new_analyze';
  return 'pipeline';
}

export function partitionLoopReds<T extends { id?: string; label?: string; pass?: boolean | null; enabled?: boolean }>(
  outcomes: T[] | undefined
): { accept: T[]; newAnalyze: T[]; pipeline: T[] } {
  const reds = (outcomes || []).filter((o) => o.enabled !== false && o.pass === false);
  const hasLabelMerge = reds.some((o) => /label_merge|merged into/.test(`${o.id || ''} ${o.label || ''}`));
  const accept: T[] = [];
  const newAnalyze: T[] = [];
  const pipeline: T[] = [];
  reds.forEach((o) => {
    const c = loopRedClass(String(o.id || ''), String(o.label || ''), { hasLabelMerge });
    if (c === 'accept') accept.push(o);
    else if (c === 'new_analyze') newAnalyze.push(o);
    else pipeline.push(o);
  });
  return { accept, newAnalyze, pipeline };
}

export type StudioLoopPlan = {
  mayLoop: boolean;
  pipelineGreen: boolean;
  promoteGreen: boolean;
  stopReason: 'green' | 'needs_new_analyze' | null;
  studioMayClaim: 'complete' | 'pipeline_done_human_analyze' | 'keep_working';
  instructions: string;
};

export function studioLoopPlan(
  outcomes: Array<{ id?: string; label?: string; pass?: boolean | null; enabled?: boolean }> | undefined,
  opts?: { mealMisses?: string[]; replayMode?: string }
): StudioLoopPlan {
  const { accept, newAnalyze, pipeline } = partitionLoopReds(outcomes);
  const presenceMiss = (opts?.mealMisses || []).filter((m) => /missing item/i.test(m));
  if (presenceMiss.length) {
    newAnalyze.push({ id: 'meal_presence', label: presenceMiss.join('; ') } as any);
  }
  const alreadyAnalyzed = opts?.replayMode === 'analyze';
  const pipelineGreen = pipeline.length === 0;
  const promoteGreen = pipelineGreen && newAnalyze.length === 0;
  if (alreadyAnalyzed && newAnalyze.length > 0) {
    return {
      mayLoop: false,
      pipelineGreen,
      promoteGreen: false,
      stopReason: 'needs_new_analyze',
      studioMayClaim: 'pipeline_done_human_analyze',
      instructions: `NEW Analyze already ran. ${newAnalyze.length} identity red(s) remain — the new scout is still wrong. Do not click NEW Analyze again until a code change. Open the food job and look at the dishes.`,
    };
  }
  if (promoteGreen) {
    return {
      mayLoop: false,
      pipelineGreen: true,
      promoteGreen: true,
      stopReason: 'green',
      studioMayClaim: 'complete',
      instructions:
        accept.length
          ? `Code-green. ${accept.length} accepted row(s) are not fails (kcal-only shelf tag, etc.). Do not POST /loop. Do not hunt them.`
          : 'All blocking checks green. Do not POST /loop.',
    };
  }
  if (pipelineGreen && newAnalyze.length > 0) {
    return {
      mayLoop: false,
      pipelineGreen: true,
      promoteGreen: false,
      stopReason: 'needs_new_analyze',
      studioMayClaim: 'pipeline_done_human_analyze',
      instructions: alreadyAnalyzed
        ? `NEW Analyze already ran. ${newAnalyze.length} identity red(s) remain — the new scout is still wrong. Do not click NEW Analyze again until a code change. Open the food job and look at the dishes.`
        : `Do NOT POST /loop. ${newAnalyze.length} red(s) need a real scout. Click NEW Analyze on this card (saved photos + query). That opens the food job so you can watch it.`,
    };
  }
  return {
    mayLoop: false,
    pipelineGreen: false,
    promoteGreen: false,
    stopReason: null,
    studioMayClaim: 'keep_working',
    instructions: `Do NOT POST /loop. ${pipeline.length} pipeline red(s) are a class job, not a meal-green search. Classify (FALSE_FRIEND / DISH_DROP / SILENT_REPAIR / …), write a unit test, two hypotheses then STOP that job. Meal replay is outer, once. You may start the next independent class in this turn.`,
  };
}

export type CheckStatus = 'fixed' | 'not_fixed' | 'need_analyze' | 'accept';

export function statusForGoldenCheck(id: string, label: string, pass?: boolean | null): CheckStatus {
  const kind = classifyStudioRed(id, label).kind;
  if (pass === true) return 'fixed';
  if (kind === 'accept') return 'accept';
  if (kind === 'new_analyze' || kind === 'follows') return 'need_analyze';
  return 'not_fixed';
}

const CHECKLIST_SKIP = new Set([
  'id_all_components_identified',
  'id_every_component_resolved',
  'id_scout_items_present',
]);

export function buildGoldenChecklist(board: any): Array<{
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  youDo?: string;
  expected?: any;
  actual?: any;
}> {
  const rows: Array<{
    id: string;
    group: string;
    label: string;
    status: CheckStatus;
    youDo?: string;
    expected?: any;
    actual?: any;
  }> = [];
  const seen = new Set<string>();
  const push = (id: string, group: string, label: string, pass?: boolean | null, expected?: any, actual?: any) => {
    if (!id || !label || CHECKLIST_SKIP.has(id) || seen.has(id) || /^j_/.test(id)) return;
    seen.add(id);
    const how = classifyStudioRed(id, label);
    rows.push({
      id,
      group: group || 'check',
      label,
      status: statusForGoldenCheck(id, label, pass),
      youDo: how.youDo,
      expected,
      actual,
    });
  };
  (board?.outcomes || []).forEach((o: any) =>
    push(o.id, o.group || o.kind, o.label, o.pass, o.expected, o.actual)
  );
  (board?.invariants || []).forEach((i: any) =>
    push(i.id, i.group, i.label, i.pass, i.expected, i.actual)
  );
  const order: Record<CheckStatus, number> = { not_fixed: 0, need_analyze: 1, accept: 2, fixed: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  return rows;
}

export function replayTapeBanner(pending: Array<{ id: string; label: string }>): string {
  const kinds = pending.map((p) => classifyStudioRed(p.id, p.label).kind);
  const lines = ['Replay log re-scores the original tape. A red here does not mean the code fix failed.'];
  if (kinds.includes('new_analyze')) {
    lines.push('Pipeline cannot rewrite a frozen scout. The check is a NEW Analyze with the same photos.');
  }
  return lines.join(' ');
}

export function formatGoldenShare(input: {
  id: string;
  title: string;
  jobId?: string;
  replayMode?: string;
  query?: string;
  photoCount?: number;
  pending: Array<{ group: string; label: string; youDo?: string }>;
  mealLines?: Array<{ name: string; expected?: string; current?: string; status: string }>;
}): string {
  const pending = input.pending.length
    ? input.pending.map((p, i) => {
        const you = p.youDo ? `\n   ${p.youDo}` : '';
        return `${i + 1}. [${p.group}] ${p.label}${you}`;
      }).join('\n')
    : '- (none)';
  const meals = (input.mealLines || []).length
    ? (input.mealLines || []).map((m) => `- ${m.name}: ${m.status} · expected ${m.expected || '—'} · current ${m.current || '—'}`).join('\n')
    : '- (none)';
  return [
    `# Golden case: ${input.title}`,
    `Case: ${input.id}`,
    `Job: ${input.jobId || '—'}`,
    `Last replay: ${input.replayMode || '—'}`,
    `Query: ${input.query ? JSON.stringify(input.query) : '(photo only)'}`,
    `Photos: ${input.photoCount ?? 0}`,
    '',
    '## Checks',
    pending,
    '',
    '## Meal lines',
    meals,
  ].join('\n');
}
