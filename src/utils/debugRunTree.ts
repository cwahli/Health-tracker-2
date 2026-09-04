/**
 * Canonical JSON Run Tree for debug observability and contract evaluation.
 * Durable specification: docs/agent/domains/debug-contract.md (§4, §5, §6, §7, §8).
 * R2 cold debug export is this canonical JSON; Markdown is a rendered view.
 */

import type { DebugReportInput } from './debugPayload.js';
import { evaluateContracts } from './dumpContract.js';

export type ContractFault = 'MISSING' | 'DUPLICATE' | 'WRONG_PLACE' | 'WRONG_TIME' | 'WRONG_COUNT' | 'none';
export type ContractLayer = 'process' | 'ui' | 'content';
export type ContractResult = 'PASS' | 'FAIL' | 'n/a';

export interface ContractEvaluation {
  law: string;
  layer: ContractLayer;
  fault: ContractFault;
  result: ContractResult;
  actual: string;
}

export interface DialogInventory {
  open: boolean;
  title?: string;
  on_card?: {
    kcal?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  };
  visible?: string[];
  hidden?: string[];
  composer?: {
    photo?: number;
    add_image?: number;
    paste?: number;
    send?: number;
    [key: string]: number | undefined;
  };
  expand?: string | boolean;
}

export interface DispatchTrace {
  id: string; // e.g. "t1/scout", "t1/dietitian", "fd/front_desk"
  parent?: string | null;
  turn?: number | string;
  agent?: string;
  user?: string;
  received?: any;
  instruction?: string;
  output?: any;
  model?: string;
  latency_ms?: number;
  tokens?: number;
  error?: string | null;
}

export interface HandoffTrace {
  from: string;
  to: string;
  received?: any;
  keysDropped?: string[];
  jobId: string;
}

export interface CanonicalRunTree {
  jobId: string;
  conversationId?: string | null;
  pack: 'food' | 'receptionist' | 'medical' | 'health_coach';
  status: string;
  exportedAt: string;
  dialogInventory?: DialogInventory | null;
  lastUserAction?: any;
  breadcrumbs: any[];
  sessionEvents: any[];
  console: string[];
  network: string[];
  handoffs: HandoffTrace[];
  dispatches: DispatchTrace[];
  contract: ContractEvaluation[];
  // Retained payload attributes for tooling / views
  pendingFoodLog?: any;
  scoutItems?: any[];
  receiptTable?: any;
  rawScout?: any;
  backendLogs?: string;
}

/** Determines which operational pack this run belongs to */
export function determinePack(input: Partial<DebugReportInput>): 'food' | 'receptionist' | 'medical' | 'health_coach' {
  if (input.pack) return input.pack;
  const agent = String(input.agentType || '').toLowerCase();
  const mode = String(input.mode || '').toLowerCase();
  if (agent === 'front_desk' || /receptionist|front.?desk/i.test(mode)) return 'receptionist';
  if (agent === 'medical' || input.ingestTrace || /biomarker|lab/i.test(mode)) return 'medical';
  if (agent === 'health_coach' || input.report || /health_coach/i.test(mode)) return 'health_coach';
  return 'food';
}

/** Deduplicate breadcrumbs by timestamp/action/target key to keep traces compact */
export function deduplicateBreadcrumbs(crumbs: any[]): any[] {
  if (!Array.isArray(crumbs)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of crumbs) {
    if (!c) continue;
    const key = typeof c === 'string'
      ? c.trim()
      : `${c.timestamp || ''}|${c.action || ''}|${c.target || ''}|${JSON.stringify(c.details || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Deduplicate session events by status/message/timestamp key */
export function deduplicateSessionEvents(events: any[]): any[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const e of events) {
    if (!e) continue;
    const key = typeof e === 'string'
      ? e.trim()
      : `${e.timestamp || ''}|${e.status || ''}|${e.message || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Extract or construct handoff records */
export function extractHandoffs(input: DebugReportInput, jobId: string): HandoffTrace[] {
  if (Array.isArray(input.handoffs) && input.handoffs.length > 0) {
    return input.handoffs;
  }
  const chain = input.handoffChain;
  if (Array.isArray(chain) && chain.length > 1) {
    const traces: HandoffTrace[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      traces.push({
        from: chain[i],
        to: chain[i + 1],
        received: input.handoffPayload,
        keysDropped: [],
        jobId,
      });
    }
    return traces;
  }
  return [];
}

/** Extract or construct agent dispatches */
export function extractDispatches(input: DebugReportInput): DispatchTrace[] {
  if (Array.isArray(input.dispatches) && input.dispatches.length > 0) {
    return input.dispatches;
  }

  const dispatches: DispatchTrace[] = [];
  const logs = input.backendLogs || '';
  const pack = determinePack(input);

  if (pack === 'receptionist') {
    dispatches.push({
      id: 'fd/front_desk',
      parent: null,
      turn: 1,
      agent: 'front_desk',
      user: input.lastUserAction?.details?.prompt || input.lastUserAction?.prompt || undefined,
      received: input.agentPayload,
      instruction: typeof input.agentInstructions === 'string' ? input.agentInstructions : undefined,
      output: input.handoffPayload || input.message,
      model: 'gemini-3.5-flash-lite',
      latency_ms: 1200,
      tokens: undefined,
      error: null,
    });
    return dispatches;
  }

  // Food pack dispatches
  const hasScout = Boolean(
    input.scoutItems?.length ||
    input.rawScout ||
    /\[Vision Scout\]|\[UnifiedLLM-Prompt:scout\]/i.test(logs)
  );

  if (hasScout) {
    const modelMatch = logs.match(/Vision Scout \(([^)]+)\)|\[UnifiedLLM\] Calling (gemini-[^\s]+)/i);
    const latencyMatch = logs.match(/(?:Vision Scout|UnifiedLLM).*?(\d+(?:\.\d+)?)ms/i);
    dispatches.push({
      id: 't1/scout',
      parent: null,
      turn: 1,
      agent: 'scout',
      user: input.lastUserAction?.details?.prompt || input.lastUserAction?.prompt || undefined,
      received: { photoCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0) },
      instruction: typeof input.agentInstructions === 'object' && !Array.isArray(input.agentInstructions)
        ? (input.agentInstructions as any)?.scout
        : undefined,
      output: input.scoutItems || input.rawScout,
      model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
      latency_ms: latencyMatch ? Math.round(Number(latencyMatch[1])) : 1500,
      tokens: undefined,
      error: input.error || null,
    });
  }

  const hasDietitian = Boolean(
    input.pendingFoodLog ||
    /\[Budget\]\s*Finalized ledger|YOU ARE THE DIETITIAN/i.test(logs)
  );

  if (hasDietitian) {
    const modelMatch = logs.match(/(?:Dietitian|UnifiedLLM).*?Calling (gemini-[^\s]+)/i);
    const latencyMatch = logs.match(/(?:Dietitian|UnifiedLLM).*?(\d+(?:\.\d+)?)ms/i);
    dispatches.push({
      id: 't1/dietitian',
      parent: hasScout ? 't1/scout' : null,
      turn: 1,
      agent: 'dietitian',
      user: input.lastUserAction?.details?.prompt || input.lastUserAction?.prompt || undefined,
      received: { scoutItemsCount: input.scoutItems?.length || 0 },
      instruction: typeof input.agentInstructions === 'object' && !Array.isArray(input.agentInstructions)
        ? (input.agentInstructions as any)?.dietitian
        : undefined,
      output: input.pendingFoodLog,
      model: modelMatch ? modelMatch[1] : 'gemini-3.5-flash-lite',
      latency_ms: latencyMatch ? Math.round(Number(latencyMatch[1])) : 2100,
      tokens: undefined,
      error: null,
    });
  }

  return dispatches;
}

/**
 * Builds the canonical JSON run tree from raw debug report input.
 * Evaluates contract laws across process, ui, and content layers.
 */
export function buildCanonicalRunTree(input: DebugReportInput): CanonicalRunTree {
  const jobId = input.jobId || 'unknown';
  const pack = determinePack(input);
  const breadcrumbs = deduplicateBreadcrumbs(input.userActionBreadcrumbs || []);
  const sessionEvents = deduplicateSessionEvents(input.sessionEvents || []);
  const consoleLogs = Array.isArray(input.clientConsoleLogs) ? input.clientConsoleLogs : [];
  const networkErrors = Array.isArray(input.networkErrors) ? input.networkErrors : [];
  const handoffs = extractHandoffs(input, jobId);
  const dispatches = extractDispatches(input);

  const tree: CanonicalRunTree = {
    jobId,
    conversationId: input.conversationId || null,
    pack,
    status: input.status || 'unknown',
    exportedAt: input.exportedAt || new Date().toISOString(),
    dialogInventory: input.dialogInventory || null,
    lastUserAction: input.lastUserAction || null,
    breadcrumbs,
    sessionEvents,
    console: consoleLogs,
    network: networkErrors,
    handoffs,
    dispatches,
    contract: [],
    pendingFoodLog: input.pendingFoodLog,
    scoutItems: input.scoutItems,
    receiptTable: input.receiptTable,
    rawScout: input.rawScout,
    backendLogs: input.backendLogs,
  };

  // Evaluate contracts on the populated tree
  tree.contract = evaluateContracts(tree);

  return tree;
}
