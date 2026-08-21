/**
 * Automatic tape review vs human visual checks.
 * Agent drains failing auto checks. Human to do only when auto is green or blocked.
 */
import type { BugWorkItem } from './bugWorkItem';

const HUMAN_LINE_RE =
  /screenshot|a11y|contrast|wcag|layout|on.?screen|visual ui|\btypo\b|copy contrast|font size|wrong color|can't tap/i;

export function isHumanCheckLine(text: string): boolean {
  return HUMAN_LINE_RE.test(String(text || ''));
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function overlap(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.includes(na)) return true;
  if (nb.length >= 12 && na.includes(nb)) return true;
  return false;
}

export function isAutoInvariant(inv: { group?: string; pass?: boolean; status?: string }): boolean {
  const g = String(inv?.group || '');
  if (/transport|shape/i.test(g) && /quota|stall|timeout/i.test(String((inv as any).label || ''))) return true;
  return /identity|resolve|math|dietitian|truth/i.test(g) || !g;
}

export function failingAutoWorkLines(board: any): string[] {
  const out: string[] = [];
  const push = (text: string) => {
    const t = String(text || '').trim();
    if (!t || isHumanCheckLine(t)) return;
    if (out.some((x) => overlap(x, t))) return;
    out.push(t);
  };
  for (const inv of board?.invariants || []) {
    if (inv?.pass === true || inv?.status === 'pass') continue;
    if (!isAutoInvariant(inv)) continue;
    push(inv.label || inv.id);
  }
  for (const h of board?.autoSpot || []) {
    if (h?.parked) continue;
    push(h.text);
  }
  return out;
}

export function overlayAutoRemaining(item: BugWorkItem, board: any): BugWorkItem {
  const auto = failingAutoWorkLines(board);
  const human = (item.remaining || []).filter((r) => isHumanCheckLine(r) && !auto.some((a) => overlap(a, r)));
  const remaining = [...auto, ...human];
  const done = (item.done || []).filter((d) => !auto.some((a) => overlap(a, d)));
  const autoOpen = remaining.filter((r) => !isHumanCheckLine(r)).length;
  return {
    ...item,
    remaining,
    done,
    queue: autoOpen ? 'in_progress' : item.queue === 'blocked' ? 'blocked' : item.queue,
  };
}

export function reviewGate(item: BugWorkItem): 'agent' | 'human' | 'stuck' | 'done' {
  if (item.queue === 'done') return 'done';
  if (item.queue === 'blocked') return 'stuck';
  const autoOpen = (item.remaining || []).filter((r) => !isHumanCheckLine(r));
  if (autoOpen.length) return 'agent';
  return 'human';
}
