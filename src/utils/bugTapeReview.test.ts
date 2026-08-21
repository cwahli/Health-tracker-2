import { describe, it, expect } from 'vitest';
import { failingAutoWorkLines, overlayAutoRemaining, reviewGate, isHumanCheckLine } from './bugTapeReview';
import { emptyWorkItem, buildContinueJob } from './bugWorkItem';

describe('automatic vs human tape review', () => {
  it('treats contrast/a11y remaining as human', () => {
    expect(isHumanCheckLine('WCAG contrast on the green tick')).toBe(true);
    expect(isHumanCheckLine('Category fallback used for: strawberry')).toBe(false);
  });

  it('overlayAutoRemaining replaces honor-system Done with failing auto checks', () => {
    const item = emptyWorkItem({
      remaining: [],
      done: ['Croissant: 9 micro keys at 0'],
      queue: 'in_progress',
    });
    const next = overlayAutoRemaining(item, {
      invariants: [
        { id: 'id_ok', label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' },
        { id: 'math_trial_balance', label: 'Trial balance drifted: Scout opening kcal vs saved table', pass: false, group: 'math' },
      ],
      autoSpot: [{ text: 'Croissant: 9 micro keys at 0', parked: false }],
    });
    expect(next.remaining).toEqual([
      'Trial balance drifted: Scout opening kcal vs saved table',
      'Croissant: 9 micro keys at 0',
    ]);
    expect(next.done).toEqual([]);
    expect(reviewGate(next)).toBe('agent');
  });

  it('continue job stops for human when only visual remaining is open', () => {
    const job = buildContinueJob({
      id: 't',
      work_item: {
        public_n: 11,
        remaining: ['WCAG contrast on Done button'],
        done: [],
        queue: 'in_progress',
      },
    });
    expect(job.stop).toBe(true);
    expect(job.keep_going).toBe(false);
    expect(job.say).toMatch(/automatic checks are green/i);
    expect(job.active_line).toBeNull();
  });

  it('failingAutoWorkLines skips passing invariants', () => {
    const lines = failingAutoWorkLines({
      invariants: [
        { label: 'Every scout dish is still in the final meal', pass: true, group: 'identity' },
        { label: 'Must not scale foundation toward scout kcal', pass: false, group: 'math' },
      ],
    });
    expect(lines).toEqual(['Must not scale foundation toward scout kcal']);
  });
});
