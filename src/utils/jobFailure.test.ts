import { describe, it, expect } from 'vitest';
import { humanizeJobFailure } from './jobFailure';

describe('humanizeJobFailure', () => {
  it('explains a 90s stall as Vision Scout / quota hang', () => {
    const s = humanizeJobFailure('Stream stalled: No response from analysis engine within 90s.');
    expect(s).toMatch(/Vision Scout/i);
    expect(s).toMatch(/3\.1 Flash Lite/i);
    expect(s).not.toMatch(/Stream stalled: No response from analysis engine/);
  });

  it('explains 429 as model quota', () => {
    const s = humanizeJobFailure('429 RESOURCE_EXHAUSTED gemini-3.5-flash-lite');
    expect(s).toMatch(/quota/i);
    expect(s).toMatch(/3\.1 Flash Lite/i);
  });
});
