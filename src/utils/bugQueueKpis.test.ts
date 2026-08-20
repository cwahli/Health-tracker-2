import { describe, it, expect } from 'vitest';
import { hydrateWorkItem } from './bugWorkItem';
import { isDoneThisWeek, queueKpis, tagIsFixed } from './bugQueueKpis';

const now = new Date('2026-08-20T21:40:00.000Z');

describe('bugQueueKpis', () => {
  it('treats status=fixed as done even if work_item.queue is still ready', () => {
    const tag = {
      status: 'fixed',
      work_item: { public_n: 4, queue: 'ready', commits: [], burns: [] },
    };
    expect(hydrateWorkItem(tag).queue).toBe('done');
    expect(tagIsFixed(tag)).toBe(true);
  });

  it('counts the live queue: 3 open, 5 done this week, not snapshot-link sum', () => {
    const tags = [
      { status: 'to_fix', work_item: { public_n: 2, queue: 'ready', occurrences: 6, commits: [], burns: [] } },
      { status: 'to_fix', work_item: { public_n: 3, queue: 'ready', occurrences: 1, commits: [{ at: '2026-08-20T17:41:00.000Z', actor: 'agent', kind: 'agent' }], burns: [] } },
      {
        status: 'fixed',
        resolved_at: '2026-08-20T19:00:00.000Z',
        work_item: { public_n: 4, queue: 'done', commits: [], burns: [] },
      },
      {
        status: 'fixed',
        work_item: {
          public_n: 5,
          queue: 'done',
          commits: [{ at: '2026-08-20T19:55:00.000Z', actor: 'agent', kind: 'agent' }],
          burns: [],
        },
      },
      { status: 'fixed', work_item: { public_n: 6, queue: 'done', commits: [], burns: [] } },
      { status: 'fixed', work_item: { public_n: 7, queue: 'done', commits: [], burns: [] } },
      { status: 'fixed', work_item: { public_n: 8, queue: 'done', commits: [], burns: [] } },
      { status: 'to_fix', work_item: { public_n: 9, queue: 'ready', occurrences: 1, commits: [], burns: [] } },
    ];
    const k = queueKpis(tags, now);
    expect(k.open).toBe(3);
    expect(k.ready).toBe(3);
    expect(k.blocked).toBe(0);
    expect(k.doneThisWeek).toBe(5);
    expect(k.doneAll).toBe(5);
    expect(k.open + k.doneAll).toBe(8);
  });

  it('does not count a month-old fixed card as done this week', () => {
    const tag = {
      status: 'fixed',
      resolved_at: '2026-07-01T00:00:00.000Z',
      work_item: { queue: 'done', commits: [], burns: [] },
    };
    expect(isDoneThisWeek(tag, now)).toBe(false);
    expect(queueKpis([tag], now).doneThisWeek).toBe(0);
  });
});
