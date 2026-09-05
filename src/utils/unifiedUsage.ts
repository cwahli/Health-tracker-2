/**
 * Stage-keyed last-call token usage for the unified LLM.
 * Written by callUnifiedLLMInternal on every successful call; consumed
 * immediately by the awaiting pipeline stage via takeUnifiedUsage.
 * Single-flight per stage (each stage awaits its call before continuing),
 * so a plain map is sufficient. Leaf module (no imports) to avoid cycles
 * between server.ts and the food pipeline shards.
 */

export interface StageUsage {
  input: number;
  output: number;
  total: number;
}

const lastByStage: Record<string, StageUsage & { at: number }> = {};
const lastTimingByStage: Record<string, { ms: number; at: number }> = {};

export function recordUnifiedUsage(stage: string, input: number, output: number, total: number): void {
  const key = (stage || '').toLowerCase();
  if (!key) return;
  lastByStage[key] = { input, output, total, at: Date.now() };
}

/** Take (consume) the recorded usage for a stage; null when the stage made no call. */
export function takeUnifiedUsage(stage: string): StageUsage | null {
  const key = (stage || '').toLowerCase();
  const u = lastByStage[key];
  delete lastByStage[key];
  return u ? { input: u.input, output: u.output, total: u.total } : null;
}

export function recordUnifiedTiming(stage: string, ms: number): void {
  const key = (stage || '').toLowerCase();
  if (!key) return;
  lastTimingByStage[key] = { ms, at: Date.now() };
}

/** Take (consume) the recorded wall-clock timing for a stage; null when absent. */
export function takeUnifiedTiming(stage: string): number | null {
  const key = (stage || '').toLowerCase();
  const t = lastTimingByStage[key];
  delete lastTimingByStage[key];
  return t ? t.ms : null;
}

/** Canonical log-line form, shared by producer (server) and parser (run tree). */
export function formatUnifiedUsage(stage: string, u: StageUsage): string {
  return `[UnifiedLLM-Usage:${(stage || '').toLowerCase() || 'unknown'}] prompt=${u.input} completion=${u.output} total=${u.total}`;
}
