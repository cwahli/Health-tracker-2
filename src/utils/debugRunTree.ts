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
  id: string; // e.g. "t1/scout", "t1/resolver", "fd/front_desk"
  parent?: string | null;
  turn?: number | string;
  agent?: string;
  user?: string;
  received?: any;
  instruction?: string;
  output?: any;
  /** Raw agent emission before pipeline transforms (e.g. scout dishes[]); working copy stays in `output`. */
  rawEmission?: any;
  /** False when the stage ran without dispatching an LLM call (projector path). */
  called?: boolean;
  /** Human note, e.g. why model/latency are absent. */
  note?: string;
  model?: string | null;
  latency_ms?: number | null;
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
  extractedData?: any;
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

/** Per-stage token usage parsed from `[UnifiedLLM-Usage:stage]` backend lines */
export interface TokenUsage {
  stage: string;
  input: number;
  output: number;
  total: number;
}

/** Parse `[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908` lines (last per stage wins) */
export function parseUnifiedUsageLines(logs: string): TokenUsage[] {
  const out = new Map<string, TokenUsage>();
  if (!logs || typeof logs !== 'string') return [];
  const re = /\[UnifiedLLM-Usage:([^\]]+)\]\s*prompt=(\d+)\s+completion=(\d+)\s+total=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    const stage = (m[1] || '').trim().toLowerCase() || 'unknown';
    out.set(stage, {
      stage,
      input: Number(m[2]) || 0,
      output: Number(m[3]) || 0,
      total: Number(m[4]) || 0,
    });
  }
  return [...out.values()];
}

/** Parse `[UnifiedLLM-Timing:stage] ms=5231` lines (last per stage wins) */
export function parseUnifiedTimingLines(logs: string): { stage: string; ms: number }[] {
  const out = new Map<string, number>();
  if (!logs || typeof logs !== 'string') return [];
  const re = /\[UnifiedLLM-Timing:([^\]]+)\]\s*ms=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    out.set((m[1] || '').trim().toLowerCase(), Number(m[2]) || 0);
  }
  return [...out.entries()].map(([stage, ms]) => ({ stage, ms }));
}

/** True when the logs prove the stage dispatched an LLM call (not a projector run).
 *  Only call-time lines count: the pipeline also logs instruction/answer lines
 *  on skip paths, so those are deliberately NOT evidence. `[scout_answer]` is
 *  kept as legacy evidence: old exports predate usage/timing lines and scout
 *  always calls. (The dietitian agent is removed; its stages never call.) */
export function hasCallEvidence(logs: string, stage: 'scout' | 'resolver'): boolean {
  if (!logs || typeof logs !== 'string') return false;
  const tag = `\\[UnifiedLLM:${stage}\\]|\\[UnifiedLLM-Prompt:${stage}\\]|\\[UnifiedLLM-Usage:${stage}\\]|\\[UnifiedLLM-Timing:${stage}\\]|\\[UnifiedLLM-Response:${stage}\\]`;
  if (stage === 'scout') {
    return new RegExp(`${tag}|\\[scout_answer\\]|\\[Vision Scout\\] Retrying`).test(logs);
  }
  return new RegExp(`${tag}|food_resolver|Food Resolver agent`).test(logs);
}

/** Prefix a log line with [jobId] unless blank or already tagged (contract §9: joinable lines) */
export function tagJobId(line: string, jobId: string): string {
  if (line == null) return line;
  const s = String(line);
  if (!s.trim() || !jobId || jobId === 'unknown') return s;
  if (s.includes(`[${jobId}]`)) return s;
  return `[${jobId}] ${s}`;
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

  if (pack === 'medical' || pack === 'health_coach') {
    dispatches.push({
      id: pack === 'medical' ? 't1/medical' : 't1/health_coach',
      parent: null,
      turn: 1,
      agent: pack,
      user: input.lastUserAction?.details?.prompt || input.lastUserAction?.prompt || undefined,
      received: input.agentPayload || input.extractedData || input.ingestTrace,
      instruction: typeof input.agentInstructions === 'string' ? input.agentInstructions : undefined,
      output: input.extractedData || input.report || input.message,
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
    const usage = parseUnifiedUsageLines(logs).find(u => u.stage === 'scout');
    const timing = parseUnifiedTimingLines(logs).find(t => t.stage === 'scout');
    dispatches.push({
      id: 't1/scout',
      parent: null,
      turn: 1,
      agent: 'scout',
      user: input.lastUserAction?.details?.prompt || input.lastUserAction?.prompt || undefined,
      received: { photoCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0) },
      instruction: (() => {
        if (typeof input.agentInstructions === 'object' && !Array.isArray(input.agentInstructions)) {
          const s = (input.agentInstructions as any)?.scout;
          if (s) return s;
        } else if (typeof input.agentInstructions === 'string' && input.agentInstructions.trim()) {
          return input.agentInstructions;
        }
        if (logs) {
          const match = logs.match(/Vision Scout System Instruction \(config\.systemInstruction\):\s*"([\s\S]+?)"(?:\n\[|\n$|$)/);
          if (match) return match[1];
        }
        return undefined;
      })(),
      output: input.scoutItems || input.rawScout,
      rawEmission: input.rawScout || undefined,
      model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
      latency_ms: timing ? timing.ms : (latencyMatch ? Math.round(Number(latencyMatch[1])) : 1500),
      tokens: usage ? usage.total : undefined,
      error: input.error || null,
    });
  }

  // Food Resolver: runs inside DB search for gap items (unknown foods needing
  // resolution). Evidence: streamed `food_resolver` status lines or usage/timing.
  const hasResolver = Boolean(
    /food_resolver|Food Resolver/i.test(logs) ||
    parseUnifiedUsageLines(logs).some(u => u.stage === 'food_resolver') ||
    parseUnifiedTimingLines(logs).some(t => t.stage === 'food_resolver')
  );

  if (hasResolver) {
    const usage = parseUnifiedUsageLines(logs).find(u => u.stage === 'food_resolver');
    const timing = parseUnifiedTimingLines(logs).find(t => t.stage === 'food_resolver');
    const modelMatch = logs.match(/Food Resolver.*?Calling (gemini-[^\s]+)|Calling (gemini-[^\s]+).*?[Rr]esolver/i);
    dispatches.push({
      id: 't1/resolver',
      parent: hasScout ? 't1/scout' : null,
      turn: 1,
      agent: 'resolver',
      user: undefined,
      received: { gapItems: true },
      instruction: undefined,
      output: undefined,
      model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
      latency_ms: timing ? timing.ms : undefined,
      tokens: usage ? usage.total : undefined,
      called: true,
      error: input.error || null,
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
  const consoleLogs = (Array.isArray(input.clientConsoleLogs) ? input.clientConsoleLogs : [])
    .map(l => tagJobId(typeof l === 'string' ? l : JSON.stringify(l), jobId));
  const networkErrors = (Array.isArray(input.networkErrors) ? input.networkErrors : [])
    .map(l => tagJobId(typeof l === 'string' ? l : JSON.stringify(l), jobId));
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
    backendLogs: typeof input.backendLogs === 'string'
      ? input.backendLogs.split('\n').map(l => tagJobId(l, jobId)).join('\n')
      : input.backendLogs,
    extractedData: input.extractedData,
  };

  // Evaluate contracts on the populated tree
  tree.contract = evaluateContracts(tree);

  return tree;
}
