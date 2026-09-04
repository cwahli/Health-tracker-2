/**
 * Dump oracles & Contract evaluation — inner loop for debug observability.
 * Evaluates contracts on CanonicalRunTree (primary) and DumpFacts (legacy markdown).
 * Classifies captures without calling Gemini or POST /loop.
 * Specification: docs/agent/domains/debug-contract.md (§1, §3, §4, §5, §9).
 */

import type {
  CanonicalRunTree,
  ContractEvaluation,
  DialogInventory,
  DispatchTrace,
  HandoffTrace,
} from './debugRunTree.js';

export type DumpFacts = {
  jobId: string | null;
  status: string | null;
  hasFinalizedLedger: boolean;
  dietitianFailedPermanently: boolean;
  matrixCalcStandby: boolean;
  breadcrumbDuplicateRows: number;
  headingDup: string[];
  diag5AutoSend: boolean;
  ledgerKcal: number | null;
  hasHappyPath: boolean;
  sessionSucceeded: boolean;
  analyzeFinishedCount: number;
  hasScoutStall: boolean;
  hasModelFallback: boolean;
  sessionFailed: boolean;
  userRetried: boolean;
  dialogInventory?: DialogInventory | null;
  contractRows?: ContractEvaluation[];
};

export type OracleFail = {
  class: string;
  id: string;
  detail: string;
  file: string;
  doNot: string;
};

export function parseDebugMarkdown(md: string): DumpFacts {
  const text = String(md || '');
  const jobId = text.match(/\*\*Job ID:\*\*\s*`([^`]+)`/)?.[1] || null;
  const status = text.match(/\*\*Status:\*\*\s*(\S+)/)?.[1] || null;
  const hasFinalizedLedger = /\[Budget\]\s*Finalized ledger/i.test(text);
  const dietitianFailedPermanently = /Dietitian Failed Permanently/i.test(text);
  const matrixCalcStandby = /\*\*5\.\s*Mathematical Calculation Engine\*\*[^\n]*Standby/i.test(text);
  const diag5AutoSend = /\[DIAG5\]\s*auto-send effect fired/i.test(text);
  const hasHappyPath = /\[MealBuild\]\s*happy-path/i.test(text);
  const sessionSucceeded = /AnalyzeFinished succeeded|result_ready|updateJob succeeded/i.test(text);
  const analyzeFinishedCount = (text.match(/AnalyzeFinished succeeded/g) || []).length;
  const hasScoutStall = /Stream stalled:.*produced no tokens for 90s/i.test(text);
  const hasModelFallback = /falling back to gemini-3\.1-flash-lite/i.test(text);
  const sessionFailed = /JobStore\.apply updateJob failed|JobQueueRunner ServerStatus failed/i.test(text);
  const userRetried = /Retrying job |\{"label":"Retry"\}|USER CONTINUATION/i.test(text);

  const kcalHits = [...text.matchAll(/(?:Calories:|Finalized ledger[^:\n]*:)\s*(\d+(?:\.\d+)?)\s*kcal/gi)];
  const ledgerKcal = kcalHits.length ? Number(kcalHits[kcalHits.length - 1][1]) : null;

  const headingCounts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (!h) continue;
    const key = h[1].replace(/\s+/g, ' ').trim();
    headingCounts.set(key, (headingCounts.get(key) || 0) + 1);
  }
  const headingDup = [...headingCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  let breadcrumbDuplicateRows = 0;
  const crumbSeen = new Set<string>();
  for (const line of text.split('\n')) {
    const row = line.match(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|\s*([^|]+)\|/);
    if (!row) continue;
    const k = line.replace(/\s+/g, ' ').trim();
    if (crumbSeen.has(k)) breadcrumbDuplicateRows += 1;
    else crumbSeen.add(k);
  }

  // Parse Dialog Inventory snapshot if present
  let dialogInventory: DialogInventory | null = null;
  const dialogSection = text.match(/## (?:🪟 )?Modal Snapshot[^\n]*\n([\s\S]*?)(?=\n## |\n---|$)/i);
  if (dialogSection) {
    const s = dialogSection[1];
    const openMatch = s.match(/- \*\*open:\*\*\s*(true|false)/i);
    const titleMatch = s.match(/- \*\*title:\*\*\s*"([^"]+)"/i);
    const onCardMatch = s.match(/- \*\*on_card:\*\*\s*(\{[^}]+\})/i);
    const visibleMatch = s.match(/- \*\*visible:\*\*\s*\[([^\]]*)\]/i);
    const hiddenMatch = s.match(/- \*\*hidden:\*\*\s*\[([^\]]*)\]/i);
    const composerMatch = s.match(/- \*\*composer:\*\*\s*(\{[^}]+\})/i);
    const expandMatch = s.match(/- \*\*expand:\*\*\s*(.+)/i);

    let on_card;
    try { if (onCardMatch) on_card = JSON.parse(onCardMatch[1]); } catch {}
    let composer;
    try { if (composerMatch) composer = JSON.parse(composerMatch[1]); } catch {}

    dialogInventory = {
      open: openMatch ? openMatch[1].toLowerCase() === 'true' : false,
      title: titleMatch ? titleMatch[1] : undefined,
      on_card,
      visible: visibleMatch && visibleMatch[1].trim() ? visibleMatch[1].split(',').map(v => v.trim()) : [],
      hidden: hiddenMatch && hiddenMatch[1].trim() ? hiddenMatch[1].split(',').map(v => v.trim()) : [],
      composer,
      expand: expandMatch ? expandMatch[1].trim() : undefined,
    };
  }

  return {
    jobId,
    status,
    hasFinalizedLedger,
    dietitianFailedPermanently,
    matrixCalcStandby,
    breadcrumbDuplicateRows,
    headingDup,
    diag5AutoSend,
    ledgerKcal,
    hasHappyPath,
    sessionSucceeded,
    analyzeFinishedCount,
    hasScoutStall,
    hasModelFallback,
    sessionFailed,
    userRetried,
    dialogInventory,
  };
}

/**
 * Evaluates the 13 contract laws from docs/agent/domains/debug-contract.md §9.
 * Operates deterministically directly on the CanonicalRunTree.
 */
export function evaluateContracts(tree: CanonicalRunTree): ContractEvaluation[] {
  const evals: ContractEvaluation[] = [];
  const logs = tree.backendLogs || '';

  // 1. SSE {final,result}
  const isSucceeded = tree.status === 'succeeded' ||
    tree.sessionEvents.some(e => /AnalyzeFinished succeeded|result_ready|updateJob succeeded/i.test(typeof e === 'string' ? e : e?.message || e?.status || ''));
  const hasLedger = Boolean(tree.pendingFoodLog) || /\[Budget\]\s*Finalized ledger/i.test(logs);

  if (isSucceeded) {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Final result emitted; job succeeded',
    });
  } else if (tree.status === 'failed') {
    const hasSalvage = /salvage/i.test(logs) || Boolean(tree.pendingFoodLog);
    if (hasSalvage) {
      evals.push({
        law: 'SSE {final,result}',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: 'Salvage final result emitted despite failure',
      });
    } else {
      evals.push({
        law: 'SSE {final,result}',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: 'Job terminated with failure without final result',
      });
    }
  } else if (hasLedger && /running|queued|processing/i.test(tree.status)) {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: `Final result computed but status remained ${tree.status}`,
    });
  } else {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: `Status: ${tree.status}`,
    });
  }

  // 2. AnalyzeFinished count = 1
  let afCount = 0;
  for (const e of tree.sessionEvents) {
    const text = typeof e === 'string' ? e : `${e.status || ''} ${e.message || ''}`;
    if (/AnalyzeFinished succeeded/i.test(text)) afCount++;
  }
  if (afCount === 0 && logs) {
    afCount = (logs.match(/AnalyzeFinished succeeded/g) || []).length;
  }

  if (afCount > 1) {
    evals.push({
      law: 'AnalyzeFinished count = 1',
      layer: 'process',
      fault: 'DUPLICATE',
      result: 'FAIL',
      actual: `AnalyzeFinished succeeded x${afCount} (upsert storm)`,
    });
  } else if (afCount === 1 || isSucceeded) {
    evals.push({
      law: 'AnalyzeFinished count = 1',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'AnalyzeFinished count = 1',
    });
  } else {
    evals.push({
      law: 'AnalyzeFinished count = 1',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'Job has not completed AnalyzeFinished',
    });
  }

  // 3. Stall/503/quota -> 3.1 hop, same job
  const hasStall = /Stream stalled:.*produced no tokens for 90s|503 Service Unavailable|RESOURCE_EXHAUSTED|quota exceeded/i.test(logs) ||
    tree.console.some(c => /stalled|503|quota/i.test(c)) ||
    tree.network.some(n => /503|quota/i.test(n));
  const hasFallback = /falling back to gemini-3\.1-flash-lite/i.test(logs) ||
    tree.dispatches.some(d => d.model?.includes('3.1'));

  if (!hasStall) {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No stall or 503 encountered',
    });
  } else if (hasFallback) {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Hopped to gemini-3.1-flash-lite fallback on same job',
    });
  } else {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'MISSING',
      result: 'FAIL',
      actual: 'Stalled without hopping to gemini-3.1-flash-lite on same job',
    });
  }

  // 4. Submit JSON running
  const submitQueued = /Submit JSON queued|status=queued/i.test(logs);
  if (submitQueued) {
    evals.push({
      law: 'Submit JSON running',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: 'Submit JSON returned queued instead of running',
    });
  } else {
    evals.push({
      law: 'Submit JSON running',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Submit transitioned directly to running',
    });
  }

  // 5. pendingFoodLog -> succeeded before R2
  if (hasLedger && !isSucceeded && /running|queued|processing/i.test(tree.status)) {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: `Ledger finalized but status remained ${tree.status} (persist lag)`,
    });
  } else if (hasLedger && isSucceeded) {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Succeeded immediately upon finalized food log',
    });
  } else {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No finalized food log in this run',
    });
  }

  // 6. Retry hidden if succeeded or kcal in logs
  if (!tree.dialogInventory) {
    evals.push({
      law: 'Retry hidden if succeeded or kcal in logs',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No dialog inventory captured',
    });
  } else {
    const isCompleted = isSucceeded || hasLedger;
    const retryVisible = Boolean(tree.dialogInventory.visible?.some(v => /retry/i.test(v)));
    if (isCompleted && retryVisible) {
      evals.push({
        law: 'Retry hidden if succeeded or kcal in logs',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: 'Retry button visible while job is succeeded or ledger has kcal',
      });
    } else {
      evals.push({
        law: 'Retry hidden if succeeded or kcal in logs',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: retryVisible ? 'Retry visible on unfinished/failed run' : 'Retry hidden on completed run',
      });
    }
  }

  // 7. Attempt 1/3 hidden if succeeded
  if (!tree.dialogInventory) {
    evals.push({
      law: 'Attempt 1/3 hidden if succeeded',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No dialog inventory captured',
    });
  } else {
    const attemptVisible = Boolean(tree.dialogInventory.visible?.some(v => /Attempt \d/i.test(v)));
    if (isSucceeded && attemptVisible) {
      evals.push({
        law: 'Attempt 1/3 hidden if succeeded',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: 'Attempt 1/3 indicator visible after job succeeded',
      });
    } else {
      evals.push({
        law: 'Attempt 1/3 hidden if succeeded',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: attemptVisible ? 'Attempt indicator visible during active retry' : 'Attempt indicator hidden',
      });
    }
  }

  // 8. Dialog on_card kcal = ledger
  if (!tree.dialogInventory?.on_card || tree.dialogInventory.on_card.kcal == null) {
    evals.push({
      law: 'Dialog on_card kcal = ledger',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No on_card macros in dialog inventory',
    });
  } else {
    const cardKcal = Number(tree.dialogInventory.on_card.kcal);
    const kcalHits = [...logs.matchAll(/(?:Calories:|Finalized ledger[^:\n]*:)\s*(\d+(?:\.\d+)?)\s*kcal/gi)];
    const ledgerKcal = tree.pendingFoodLog?.nutrients?.calories ?? (kcalHits.length ? Number(kcalHits[kcalHits.length - 1][1]) : null);
    if (ledgerKcal == null) {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'none',
        result: 'n/a',
        actual: `Card shows ${cardKcal} kcal; no ledger kcal found to compare`,
      });
    } else if (Math.abs(cardKcal - ledgerKcal) > 1) {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: `Dialog card shows ${cardKcal} kcal but ledger has ${ledgerKcal} kcal`,
      });
    } else {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: `Dialog card matches ledger (${cardKcal} kcal)`,
      });
    }
  }

  // 9. Composer controls count = 1
  if (!tree.dialogInventory?.composer) {
    evals.push({
      law: 'Composer controls count = 1',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No composer inventory captured',
    });
  } else {
    const composer = tree.dialogInventory.composer;
    const duplicates = Object.entries(composer).filter(([_, c]) => typeof c === 'number' && c > 1);
    const missing = Object.entries(composer).filter(([_, c]) => typeof c === 'number' && c === 0);
    if (duplicates.length > 0) {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'DUPLICATE',
        result: 'FAIL',
        actual: `Duplicate composer controls: ${duplicates.map(([k, c]) => `${k} x${c}`).join(', ')}`,
      });
    } else if (missing.length > 0 && tree.dialogInventory.open) {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `Missing composer controls: ${missing.map(([k]) => k).join(', ')}`,
      });
    } else {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: 'All composer controls count = 1',
      });
    }
  }

  // 10. DIAG5 off on food
  const isFood = tree.pack === 'food';
  const diag5Fired = /\[DIAG5\]\s*auto-send effect fired/i.test(logs) ||
    tree.sessionEvents.some(e => /\[DIAG5\]/i.test(typeof e === 'string' ? e : e?.message || ''));

  if (!isFood) {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: `Not a food chat job (pack=${tree.pack})`,
    });
  } else if (diag5Fired) {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'WRONG_PLACE',
      result: 'FAIL',
      actual: 'DIAG5 auto-send effect fired on food chat',
    });
  } else {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'DIAG5 auto-send remained off for food chat',
    });
  }

  // 11. Matrix calc matches ledger
  const matrixStandby = /\*\*5\.\s*Mathematical Calculation Engine\*\*[^\n]*Standby/i.test(logs);
  if (hasLedger && matrixStandby) {
    evals.push({
      law: 'Matrix calc matches ledger',
      layer: 'content',
      fault: 'MISSING',
      result: 'FAIL',
      actual: 'Pipeline matrix math Standby while logs have Finalized ledger',
    });
  } else {
    evals.push({
      law: 'Matrix calc matches ledger',
      layer: 'content',
      fault: 'none',
      result: 'PASS',
      actual: hasLedger ? 'Matrix connected and matches ledger' : 'No meal ledger required',
    });
  }

  // 12. Each dispatch has model + latency_ms
  if (!tree.dispatches || tree.dispatches.length === 0) {
    evals.push({
      law: 'Each dispatch has model + latency_ms',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No dispatches recorded in this run',
    });
  } else {
    const invalid = tree.dispatches.filter(d => !d.model || d.latency_ms == null);
    if (invalid.length > 0) {
      evals.push({
        law: 'Each dispatch has model + latency_ms',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `${invalid.length} dispatch(es) missing model or latency_ms (${invalid.map(d => d.id).join(', ')})`,
      });
    } else {
      evals.push({
        law: 'Each dispatch has model + latency_ms',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: `All ${tree.dispatches.length} dispatch(es) contain model and latency_ms`,
      });
    }
  }

  // 13. Handoff from/to + same jobId if transfer
  if (!tree.handoffs || tree.handoffs.length === 0) {
    evals.push({
      law: 'Handoff from/to + same jobId if transfer',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No agent handoffs in this run',
    });
  } else {
    const invalid = tree.handoffs.filter(h => !h.from || !h.to || (h.jobId && h.jobId !== tree.jobId));
    if (invalid.length > 0) {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `${invalid.length} handoff(s) invalid or mismatched jobId (${invalid.map(h => `${h.from}->${h.to}`).join(', ')})`,
      });
    } else {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: `All ${tree.handoffs.length} handoff(s) contain valid from/to with matching jobId`,
      });
    }
  }

  return evals;
}

function isCanonicalRunTree(obj: any): obj is CanonicalRunTree {
  return obj && typeof obj === 'object' && Array.isArray(obj.contract) && 'pack' in obj;
}

export function classifyDump(factsOrTree: DumpFacts | CanonicalRunTree): OracleFail[] {
  const fails: OracleFail[] = [];

  if (isCanonicalRunTree(factsOrTree)) {
    const tree = factsOrTree;
    const logs = tree.backendLogs || '';
    const hasFinalizedLedger = Boolean(tree.pendingFoodLog) || /\[Budget\]\s*Finalized ledger/i.test(logs);
    const dietitianFailedPermanently = /Dietitian Failed Permanently/i.test(logs);

    if (hasFinalizedLedger && dietitianFailedPermanently && tree.status && /running|queued|processing/i.test(tree.status)) {
      fails.push({
        class: 'DEGRADE_NOT_TERMINAL',
        id: 'JOB_TERMINAL_IF_LEDGER',
        detail: `status=${tree.status} after Finalized ledger + Dietitian Failed Permanently`,
        file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
        doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
      });
    }

    // Map any failed contract evaluations directly to OracleFails
    for (const c of tree.contract) {
      if (c.result !== 'FAIL') continue;

      if (c.law === 'Matrix calc matches ledger') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'DEBUG_MATCHES_LOG',
          detail: c.actual,
          file: 'src/utils/debugPayload.ts',
          doNot: 'FoodCard layout, catalog aliases',
        });
      } else if (c.law === 'DIAG5 off on food') {
        fails.push({
          class: 'SIBLING_EFFECT',
          id: 'NO_FOREIGN_EFFECT',
          detail: c.actual,
          file: 'src/utils/chatAutoSend.ts, LogChat.tsx auto-send effect',
          doNot: 'server_food_analyze_run.ts, expected.json',
        });
      } else if (c.law === 'pendingFoodLog -> succeeded before R2') {
        fails.push({
          class: 'DISPLAY_LAG',
          id: 'RESULT_READY_BEFORE_PERSIST',
          detail: c.actual,
          file: 'serverJobs.ts publishResultReady, JobQueueRunner (complete once)',
          doNot: 'expected.json, FoodCard rewrite, live Gemini retry',
        });
      } else if (c.law === 'AnalyzeFinished count = 1') {
        fails.push({
          class: 'COMPLETE_ONCE',
          id: 'ANALYZE_FINISHED_ONCE',
          detail: c.actual,
          file: 'src/jobs/JobQueueRunner.ts inFlightIds + skip if already succeeded',
          doNot: 'POST /loop, extra persist',
        });
      } else if (c.law === 'Stall/503/quota -> 3.1 hop, same job') {
        fails.push({
          class: 'STALL_NO_FALLBACK',
          id: 'STALL_FALLBACK_SAME_JOB',
          detail: c.actual,
          file: 'server_gemini_retry.ts nextGeminiFallbackEngine, serverJobs.ts loopback retry',
          doNot: 'expected.json, live Gemini inner loop, POST /loop, FoodCard rewrite',
        });
      } else if (c.law === 'Dialog on_card kcal = ledger') {
        fails.push({
          class: 'DISPLAY_LAG',
          id: 'UI_ON_CARD_MISMATCH',
          detail: c.actual,
          file: 'src/components/LogChat.tsx, src/utils/debugPayload.ts',
          doNot: 'Rewrite FoodCard',
        });
      } else if (c.law === 'Composer controls count = 1') {
        fails.push({
          class: 'DEBUG_DUP',
          id: 'UI_COMPOSER_CONTROLS',
          detail: c.actual,
          file: 'src/components/LogChat.tsx',
          doNot: 'Delete controls',
        });
      } else if (c.law === 'Each dispatch has model + latency_ms') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'DISPATCH_SIGNALS_MISSING',
          detail: c.actual,
          file: 'src/utils/debugRunTree.ts, serverJobs.ts',
          doNot: 'Mock latencies',
        });
      } else if (c.law === 'Handoff from/to + same jobId if transfer') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'HANDOFF_CONTRACT_MISSING',
          detail: c.actual,
          file: 'src/utils/debugRunTree.ts, serverJobs.ts',
          doNot: 'Drop handoff context',
        });
      } else if (c.law === 'Submit JSON running') {
        fails.push({
          class: 'QUEUE_LIE',
          id: 'SUBMIT_NOT_QUEUED',
          detail: c.actual,
          file: 'src/components/LogChat.tsx, serverJobs.ts',
          doNot: 'Clobber running state',
        });
      }
    }

    return fails;
  }

  // Fallback for legacy DumpFacts (e.g. from historical captures)
  const facts = factsOrTree;
  if (facts.hasFinalizedLedger && facts.dietitianFailedPermanently && facts.status && /running|queued|processing/i.test(facts.status)) {
    fails.push({
      class: 'DEGRADE_NOT_TERMINAL',
      id: 'JOB_TERMINAL_IF_LEDGER',
      detail: `status=${facts.status} after Finalized ledger + Dietitian Failed Permanently`,
      file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
      doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
    });
  }
  if (facts.hasFinalizedLedger && facts.matrixCalcStandby) {
    fails.push({
      class: 'DEBUG_MISS',
      id: 'DEBUG_MATCHES_LOG',
      detail: 'pipeline matrix math Standby while logs have Finalized ledger',
      file: 'src/utils/debugPayload.ts',
      doNot: 'FoodCard layout, catalog aliases',
    });
  }
  if (facts.breadcrumbDuplicateRows > 0) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `${facts.breadcrumbDuplicateRows} duplicate breadcrumb row(s)`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (facts.headingDup.length) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `duplicate ## ${facts.headingDup.join(', ')}`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (facts.diag5AutoSend) {
    fails.push({
      class: 'SIBLING_EFFECT',
      id: 'NO_FOREIGN_EFFECT',
      detail: 'DIAG5 auto-send fired (Front Desk handoff effect) on this food dump',
      file: 'src/utils/chatAutoSend.ts, LogChat.tsx auto-send effect',
      doNot: 'server_food_analyze_run.ts, expected.json',
    });
  }
  if (facts.hasHappyPath && (facts.hasFinalizedLedger || facts.ledgerKcal != null) && !facts.sessionSucceeded) {
    fails.push({
      class: 'DISPLAY_LAG',
      id: 'RESULT_READY_BEFORE_PERSIST',
      detail: `happy-path + ${facts.ledgerKcal} kcal in dump but session never succeeded — poller waited on R2/upsert`,
      file: 'serverJobs.ts publishResultReady, JobQueueRunner (complete once)',
      doNot: 'expected.json, FoodCard rewrite, live Gemini retry',
    });
  }
  if (facts.analyzeFinishedCount > 1) {
    fails.push({
      class: 'COMPLETE_ONCE',
      id: 'ANALYZE_FINISHED_ONCE',
      detail: `AnalyzeFinished succeeded x${facts.analyzeFinishedCount} (upsert storm)`,
      file: 'src/jobs/JobQueueRunner.ts inFlightIds + skip if already succeeded',
      doNot: 'POST /loop, extra persist',
    });
  }
  if (facts.hasScoutStall && !facts.hasModelFallback && (facts.sessionFailed || facts.userRetried || !facts.sessionSucceeded)) {
    fails.push({
      class: 'STALL_NO_FALLBACK',
      id: 'STALL_FALLBACK_SAME_JOB',
      detail: 'Vision Scout 90s stall failed the job / forced Retry — did not hop to gemini-3.1-flash-lite on the same job',
      file: 'server_gemini_retry.ts nextGeminiFallbackEngine, serverJobs.ts loopback retry',
      doNot: 'expected.json, live Gemini inner loop, POST /loop, FoodCard rewrite',
    });
  }
  return fails;
}

export function formatOracleFails(fails: OracleFail[]): string {
  if (!fails.length) return 'dump oracles: none (capture is not a classified red)\n';
  return fails
    .map(
      (f) =>
        `${f.id}  ${f.detail}\n  class: ${f.class}\n  file:  ${f.file}\n  do not: ${f.doNot}`
    )
    .join('\n\n');
}
