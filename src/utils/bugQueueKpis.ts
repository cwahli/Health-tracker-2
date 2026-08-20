/**
 * Queue dashboard KPIs. Overview must include this week's done tags
 * or "Done this week" stays 0 after the green tick hides them from to_fix.
 */
import { BURN_BUDGET, getLastActionedDate, hydrateWorkItem } from './bugWorkItem';

const DAY_MS = 24 * 60 * 60 * 1000;

export function tagIsFixed(tag: any): boolean {
  const item = hydrateWorkItem(tag);
  const status = String(tag?.status || '').toLowerCase();
  return item.queue === 'done' || status === 'fixed' || status === 'ignored';
}

export function tagResolvedAt(tag: any): Date | null {
  if (tag?.resolved_at) {
    const d = new Date(tag.resolved_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!tagIsFixed(tag)) return null;
  return getLastActionedDate(tag);
}

export function isDoneThisWeek(tag: any, now: Date = new Date(), days = 7): boolean {
  if (!tagIsFixed(tag)) return false;
  const at = tagResolvedAt(tag);
  if (!at) return true;
  return now.getTime() - at.getTime() <= days * DAY_MS;
}

export type BugQueueKpis = {
  ready: number;
  blocked: number;
  open: number;
  doneThisWeek: number;
  doneAll: number;
};

export function queueKpis(tags: any[], now: Date = new Date()): BugQueueKpis {
  const list = Array.isArray(tags) ? tags : [];
  const open = list.filter((t) => !tagIsFixed(t));
  return {
    ready: open.filter((t) => hydrateWorkItem(t).queue === 'ready').length,
    blocked: open.filter((t) => {
      const item = hydrateWorkItem(t);
      return item.queue === 'blocked' || item.burns.filter((b) => b.burned).length >= BURN_BUDGET;
    }).length,
    open: open.length,
    doneThisWeek: list.filter((t) => isDoneThisWeek(t, now)).length,
    doneAll: list.filter((t) => tagIsFixed(t)).length,
  };
}
