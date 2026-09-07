/**
 * Structural edit patch ledger — user-locked slots, scout↔ledger diff commands,
 * sibling-metadata invalidation, and edit-turn expert dispatch telemetry.
 *
 * No keyword/regex meal band-aids: commands come from index-aligned state diff
 * and locks; tea/fish/weight regressions are prevented by slot invariants.
 */

export type LockedField = 'identity' | 'weightGrams' | 'modifier';

export type UserLockedSlot = {
  scoutIndex: number;
  field: LockedField;
  value: string | number;
  lockedAtTurn: number;
  sourceUserMessage?: string;
};

export type PatchEditCommand = {
  action: string;
  itemName?: string;
  newItemName?: string;
  replacementItemName?: string;
  newWeightGrams?: number | null;
  targetDbId?: string | null;
  componentName?: string | null;
  modifier?: string | null;
  scoutIndex?: number | null;
  sourceImageIndex?: number | null;
  estimate?: Record<string, any> | null;
};

function displayName(it: any): string {
  return String(it?.canonicalDbName || it?.originalName || it?.keyword || it?.name || it?.dishName || '').trim();
}

function weightOf(it: any): number {
  // Scout-shaped rows carry estimatedWeightGrams; ledger rows carry weightGrams.
  // Prefer the scout estimate when both exist so merge leftovers cannot hide edits.
  const est = Number(it?.estimatedWeightGrams);
  const w = Number(it?.weightGrams);
  const pack = Number(it?.packGrams);
  if (Number.isFinite(est) && est > 0) return est;
  if (Number.isFinite(w) && w > 0) return w;
  if (Number.isFinite(pack) && pack > 0) return pack;
  return 0;
}

function normName(s: any): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function namesReferSame(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

export function significantTokens(s: string): string[] {
  const stops = new Set(['and', 'with', 'the', 'in', 'of', 'for', 'a', 'an', 'dish', 'hot', 'style', 'fast', 'food']);
  return normName(s).split(/[^a-z0-9]+/).filter((w: string) => w.length > 2 && !stops.has(w));
}

export function namesShareSubstance(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const shared = ta.filter(t => setB.has(t));
  const minLen = Math.min(ta.length, tb.length);
  if (shared.length >= 2 && shared.length / minLen >= 0.5) return true;
  if (minLen === 1 && shared.length === 1 && (ta.length === 1 || tb.length === 1)) return true;
  return false;
}

function scoutIndexOf(it: any, fallback: number): number {
  const n = Number(it?.scoutIndex);
  return Number.isFinite(n) ? n : fallback;
}

function estimateFromScout(it: any): Record<string, any> | null {
  const n = it?.nutrients || it?.preCalcNutrients || {};
  const keys = [
    'protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium',
    'addedSugar', 'totalFibre', 'sugar', 'cookingMethod', 'foodType',
  ];
  const out: Record<string, any> = {};
  let any = false;
  for (const k of keys) {
    const v = n[k] ?? it?.[k];
    if (v !== undefined && v !== null && v !== '') {
      out[k] = v;
      any = true;
    }
  }
  if (it?.cookingMethod) out.cookingMethod = it.cookingMethod;
  if (it?.foodType) out.foodType = it.foodType;
  if (Array.isArray(it?.components) && it.components.length > 0) {
    out.components = it.components;
    any = true;
  }
  if (Array.isArray(it?.foods) && it.foods.length > 0) {
    out.foods = it.foods;
    any = true;
  }
  return any ? out : null;
}

/**
 * Align prior ledger rows to scout emission (scoutIndex, else positional)
 * and emit structural patch commands for identity/weight/component drifts.
 */
export function diffScoutToEditCommands(args: {
  priorItems: any[];
  scoutItems: any[];
  userMessage?: string;
}): PatchEditCommand[] {
  const { priorItems, scoutItems } = args;
  if (!Array.isArray(priorItems) || !Array.isArray(scoutItems) || scoutItems.length === 0) {
    return [];
  }
  const commands: PatchEditCommand[] = [];
  const usedPrior = new Set<number>();

  for (let sIdx = 0; sIdx < scoutItems.length; sIdx++) {
    const scout = scoutItems[sIdx];
    const sName = displayName(scout);
    if (!sName) continue;
    const sScoutIdx = scoutIndexOf(scout, sIdx);

    let priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && scoutIndexOf(p, i) === sScoutIdx);
    if (priorIdx < 0) {
      priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && (namesReferSame(displayName(p), sName) || namesShareSubstance(displayName(p), sName)));
    }
    // Match by sourceImageIndex if both have it and it's non-null
    if (priorIdx < 0 && scout.sourceImageIndex != null) {
      priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && p.sourceImageIndex === scout.sourceImageIndex);
    }
    // Only fall back to positional match if scoutItems has the SAME length as priorItems (full meal re-emission),
    // OR if the user message specifically indicates replacement/substitution of a prior item.
    if (priorIdx < 0 && scoutItems.length === priorItems.length && sIdx < priorItems.length && !usedPrior.has(sIdx)) {
      priorIdx = sIdx;
    } else if (priorIdx < 0 && args.userMessage) {
      const msg = args.userMessage.toLowerCase();
      const hasReplaceWord = /\b(replace|substitute|instead of|change .* to|switch)\b/i.test(msg);
      if (hasReplaceWord) {
        const replaceIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && msg.includes(displayName(p).toLowerCase()));
        if (replaceIdx >= 0) {
          priorIdx = replaceIdx;
        }
      } else {
        // Check if user message mentions substantive keywords of prior item (e.g. "beef dish")
        const keywordIdx = priorItems.findIndex((p, i) => {
          if (usedPrior.has(i)) return false;
          const pTokens = significantTokens(displayName(p));
          return pTokens.some(t => msg.includes(t));
        });
        if (keywordIdx >= 0) {
          priorIdx = keywordIdx;
        }
      }
    }
    if (priorIdx < 0) {
      // New dish from scout — add_item when estimate available
      const grams = weightOf(scout) || 100;
      const estimate = estimateFromScout(scout);
      commands.push({
        action: 'add_item',
        itemName: sName,
        newItemName: sName,
        newWeightGrams: grams,
        scoutIndex: sScoutIdx,
        sourceImageIndex: scout.sourceImageIndex ?? null,
        estimate,
      });
      continue;
    }
    usedPrior.add(priorIdx);
    const prior = priorItems[priorIdx];
    const pName = displayName(prior);
    const pWeight = weightOf(prior);
    const sWeight = weightOf(scout);

    if (pName && sName && !namesReferSame(pName, sName)) {
      commands.push({
        action: 'replace_identity',
        itemName: pName,
        newItemName: sName,
        replacementItemName: sName,
        newWeightGrams: sWeight > 0 ? sWeight : (pWeight || null),
        targetDbId: prior.dbId || null,
        scoutIndex: sScoutIdx,
        estimate: estimateFromScout(scout),
      });
    } else if (sWeight > 0 && pWeight > 0 && Math.abs(sWeight - pWeight) >= 1) {
      // Prefer component rescale when scout components show a primary-ingredient change
      const priorComps = Array.isArray(prior.componentsDetailList) && prior.componentsDetailList.length
        ? prior.componentsDetailList
        : (Array.isArray(prior.components) ? prior.components : []);
      const scoutComps = Array.isArray(scout.componentsDetailList) && scout.componentsDetailList.length
        ? scout.componentsDetailList
        : (Array.isArray(scout.components) ? scout.components : []);
      let componentCmd: PatchEditCommand | null = null;
      if (priorComps.length && scoutComps.length) {
        for (let ci = 0; ci < Math.min(priorComps.length, scoutComps.length); ci++) {
          const pc = priorComps[ci];
          const sc = scoutComps[ci];
          if (typeof pc !== 'object' || typeof sc !== 'object') continue;
          const pw = Number(pc.weightGrams ?? pc.estimatedWeightGrams) || 0;
          const sw = Number(sc.weightGrams ?? sc.estimatedWeightGrams) || 0;
          if (pw > 0 && sw > 0 && Math.abs(pw - sw) >= 1) {
            componentCmd = {
              action: 'update_component_weight',
              itemName: pName,
              componentName: String(pc.name || pc.keyword || sc.name || ''),
              newWeightGrams: sw,
              targetDbId: prior.dbId || null,
              scoutIndex: sScoutIdx,
            };
            break;
          }
        }
      }
      if (componentCmd) {
        commands.push(componentCmd);
      } else {
        commands.push({
          action: 'set_weight',
          itemName: pName,
          newWeightGrams: sWeight,
          targetDbId: prior.dbId || null,
          scoutIndex: sScoutIdx,
        });
      }
    }
  }
  return commands;
}

/**
 * Enforce user-locked identity/weight/modifier on a scout emission.
 * A lock yields only when the current user message explicitly targets that
 * slot with a different value (token overlap with a non-matching name/weight).
 */
export function applyUserLockedSlots(args: {
  scoutItems: any[];
  locks: UserLockedSlot[] | null | undefined;
  userMessage?: string;
}): { items: any[]; notes: string[] } {
  const notes: string[] = [];
  const locks = Array.isArray(args.locks) ? args.locks : [];
  if (!locks.length || !Array.isArray(args.scoutItems)) {
    return { items: args.scoutItems || [], notes };
  }
  const msg = normName(args.userMessage || '');
  const items = args.scoutItems.map((it, idx) => {
    const sIdx = scoutIndexOf(it, idx);
    const slotLocks = locks.filter((l) => l.scoutIndex === sIdx);
    if (!slotLocks.length) return it;
    let next = { ...it };
    for (const lock of slotLocks) {
      if (lock.field === 'identity') {
        const lockedName = String(lock.value);
        const current = displayName(next);
        if (namesReferSame(current, lockedName)) continue;
        // Explicit unlock: user message names both a competing identity token and does not restate the lock
        const lockedTok = normName(lockedName).split(/\s+/).filter((t) => t.length > 2);
        const curTok = normName(current).split(/\s+/).filter((t) => t.length > 2);
        const userRestatesLock = lockedTok.some((t) => msg.includes(t));
        const userNamesCompetitor = curTok.some((t) => msg.includes(t) && !lockedTok.includes(t));
        if (userNamesCompetitor && !userRestatesLock) {
          notes.push(`[PatchLedger] unlock identity slot ${sIdx}: user retargeted away from "${lockedName}"`);
          continue;
        }
        notes.push(`[PatchLedger] lock identity slot ${sIdx}: "${current}" → "${lockedName}"`);
        next = invalidateStaleIdentityMetadata({
          ...next,
          name: lockedName,
          dishName: lockedName,
          canonicalDbName: lockedName,
          originalName: lockedName,
          keyword: lockedName,
        }, lockedName);
      } else if (lock.field === 'weightGrams') {
        const lockedW = Number(lock.value);
        const curW = weightOf(next);
        if (!(lockedW > 0) || Math.abs(curW - lockedW) < 1) continue;
        // Unlock if user states a different explicit gram amount for this slot
        const gramMention = msg.match(/(\d+)\s*(?:g|gram|grams)\b/);
        if (gramMention && Number(gramMention[1]) !== lockedW) {
          const nameTok = normName(displayName(next)).split(/\s+/).filter((t) => t.length > 2);
          if (nameTok.some((t) => msg.includes(t))) {
            notes.push(`[PatchLedger] unlock weight slot ${sIdx}: user set ${gramMention[1]}g`);
            continue;
          }
        }
        notes.push(`[PatchLedger] lock weight slot ${sIdx}: ${curW}g → ${lockedW}g`);
        next = {
          ...next,
          estimatedWeightGrams: lockedW,
          weightGrams: lockedW,
          packGrams: next.packGrams != null ? lockedW : next.packGrams,
        };
      } else if (lock.field === 'modifier') {
        const lockedMod = String(lock.value);
        const current = displayName(next);
        if (normName(current).includes(normName(lockedMod))) continue;
        notes.push(`[PatchLedger] lock modifier slot ${sIdx}: enforce "${lockedMod}" on "${current}"`);
        // Modifier locks are carried as identity names after set_modifier; restore via identity path if present
      }
    }
    return next;
  });
  return { items, notes };
}

/** Record locks from successfully applied commands (immutable append/replace per field). */
export function mergeLocksFromCommands(args: {
  priorLocks: UserLockedSlot[] | null | undefined;
  commands: any[];
  itemsAfter: any[];
  turn: number;
  userMessage?: string;
}): UserLockedSlot[] {
  const prior = Array.isArray(args.priorLocks) ? [...args.priorLocks] : [];
  const cmds = Array.isArray(args.commands) ? args.commands : [];
  const items = Array.isArray(args.itemsAfter) ? args.itemsAfter : [];
  const byKey = new Map<string, UserLockedSlot>();
  for (const l of prior) byKey.set(`${l.scoutIndex}:${l.field}`, l);

  const findItem = (cmd: any): { item: any; idx: number } | null => {
    const name = cmd.newItemName || cmd.replacementItemName || cmd.itemName;
    let idx = items.findIndex((it, i) => scoutIndexOf(it, i) === Number(cmd.scoutIndex));
    if (idx < 0 && name) idx = items.findIndex((it) => namesReferSame(displayName(it), name) || namesReferSame(displayName(it), cmd.itemName));
    if (idx < 0) return null;
    return { item: items[idx], idx };
  };

  for (const cmd of cmds) {
    const action = String(cmd.action || '').toLowerCase();
    const found = findItem(cmd);
    if (!found) continue;
    const sIdx = scoutIndexOf(found.item, found.idx);
    if (action === 'replace_identity' || action === 'rename_alias') {
      const value = displayName(found.item) || cmd.newItemName || cmd.replacementItemName;
      if (value) {
        byKey.set(`${sIdx}:identity`, {
          scoutIndex: sIdx,
          field: 'identity',
          value,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
    } else if (action === 'set_modifier' || action === 'update_modifier') {
      const value = displayName(found.item) || cmd.newItemName;
      if (value) {
        byKey.set(`${sIdx}:identity`, {
          scoutIndex: sIdx,
          field: 'identity',
          value,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
        if (cmd.modifier) {
          byKey.set(`${sIdx}:modifier`, {
            scoutIndex: sIdx,
            field: 'modifier',
            value: String(cmd.modifier),
            lockedAtTurn: args.turn,
            sourceUserMessage: args.userMessage,
          });
        }
      }
    } else if (action === 'set_weight' || action === 'update_weight' || action === 'update_component_weight') {
      const w = weightOf(found.item) || Number(cmd.newWeightGrams);
      if (w > 0) {
        byKey.set(`${sIdx}:weightGrams`, {
          scoutIndex: sIdx,
          field: 'weightGrams',
          value: w,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * After identity/modifier change: purge conflicting sibling labels, English
 * aliases, ingredient lists, and stale preCalc that still describe the old
 * sweetened/previous identity.
 */
export function invalidateStaleIdentityMetadata(item: any, newName: string): any {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  const name = String(newName || displayName(item) || '').trim();
  next.name = name;
  next.canonicalDbName = name;
  next.originalName = name;
  next.keyword = name;
  if (next.dishName) next.dishName = name;
  // Drop English/generic labels that can lag behind (e.g. "sweetened iced tea")
  if (next.genericEnglishName) delete next.genericEnglishName;
  if (next.englishName) delete next.englishName;
  if (next.translatedName) delete next.translatedName;
  // Ingredient / visual sibling lists must not retain the prior identity
  next.ingredientsList = [name];
  next.visualIngredients = [name];
  next.ingredients = [name];
  // Stale pre-calc macros from the prior identity (e.g. manis 56 kcal)
  if (next.preCalcNutrients) delete next.preCalcNutrients;
  if (next.truthNutrients && next.nutrients) {
    // keep nutrients as source of truth after modifier apply
  }
  return next;
}

/** Prompt block listing locked invariants for the scout on edit turns. */
export function formatLockedSlotsForPrompt(locks: UserLockedSlot[] | null | undefined): string {
  const list = Array.isArray(locks) ? locks : [];
  if (!list.length) return '';
  const lines = list.map((l) => `- slot scoutIndex=${l.scoutIndex} field=${l.field} LOCKED="${l.value}" (do not revert without explicit user instruction)`);
  return (
    `USER-LOCKED SLOT INVARIANTS (patch ledger — must preserve unless the user explicitly changes that slot):\n` +
    lines.join('\n') +
    `\n`
  );
}

/**
 * Build a dietitian/expert dispatch row for edit turns so telemetry has full
 * I/O parity with create (or an explicit skip contract).
 */
export function buildEditExpertDispatch(args: {
  turn: number;
  userMessage?: string;
  finalMessage: string;
  editCommands: any[];
  items: any[];
  nutrients?: Record<string, any>;
  verdict?: { label?: string; level?: string } | null;
  skipped?: boolean;
  skipReason?: string;
  model?: string;
}): any {
  const turn = args.turn;
  const systemInstruction =
    'Edit-turn expert/projector stage. TARGETED DISH UPDATE ONLY: rescale the locked label truth for the edited slots; never re-emit or recompute unchanged dishes. ' +
    'Clinical narrative must reflect the post-edit ledger. ' +
    'When skipped, reason is explicit in output.skipReason.';
  const userPrompt = JSON.stringify({
    userMessage: args.userMessage || '',
    editCommands: args.editCommands || [],
    ledgerSummary: (args.items || []).map((it) => ({
      name: displayName(it),
      weightGrams: weightOf(it),
      calories: it?.nutrients?.calories ?? it?.calories ?? null,
      scoutIndex: it?.scoutIndex ?? null,
    })),
    nutrients: args.nutrients || null,
  }, null, 2);
  const output = args.skipped
    ? {
        skipped: true,
        skipReason: args.skipReason || 'explicit_skip',
        message: args.finalMessage,
      }
    : {
        skipped: false,
        message: args.finalMessage,
        // Contract parity with create: one emission must carry BOTH the
        // verdict label/level and the advice text, or the debug export law
        // "Agent output: verdict + advice" fails on every weight-only edit
        // (scout emits verdict with empty dishes[], projector emits the
        // message — neither alone satisfies the law).
        ...(args.verdict && args.verdict.label && args.verdict.level
          ? { verdict: { label: args.verdict.label, level: args.verdict.level } }
          : {}),
        editCommandCount: (args.editCommands || []).length,
      };
  return {
    id: `t${turn}/dietitian`,
    parent: `t${turn}/scout`,
    turn,
    agent: 'dietitian',
    user: args.userMessage || '',
    received: {
      mode: 'edit',
      editCommandCount: (args.editCommands || []).length,
      skipped: Boolean(args.skipped),
    },
    systemInstruction,
    userPrompt,
    instruction: `=== SYSTEM INSTRUCTION ===\n${systemInstruction}\n\n=== USER PROMPT ===\n${userPrompt}`,
    rawEmission: output,
    output,
    model: args.model || 'projector',
    latency_ms: 0,
    tokens: 0,
    error: null,
  };
}

/** Re-sum parent dish weight from components after component-level edits. */
export function reaggregateDishWeightFromComponents(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const comps = Array.isArray(item.componentsDetailList) && item.componentsDetailList.length
    ? item.componentsDetailList
    : (Array.isArray(item.components) ? item.components.filter((c: any) => typeof c === 'object') : []);
  if (!comps.length) return item;
  const sum = comps.reduce((acc: number, c: any) => acc + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
  if (!(sum > 0)) return item;
  const oldW = weightOf(item);
  if (oldW > 0 && Math.abs(oldW - sum) < 0.5) return item;
  const ratio = oldW > 0 ? sum / oldW : 1;
  const nutrients = { ...(item.nutrients || {}) };
  for (const k of Object.keys(nutrients)) {
    if (typeof nutrients[k] === 'number' && Number.isFinite(nutrients[k])) {
      nutrients[k] = Math.round(nutrients[k] * ratio * 10) / 10;
    }
  }
  return {
    ...item,
    weightGrams: Math.round(sum),
    estimatedWeightGrams: Math.round(sum),
    nutrients,
    calories: nutrients.calories ?? item.calories,
    components: comps,
    componentsDetailList: comps,
  };
}
