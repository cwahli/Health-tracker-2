import { describe, it, expect } from 'vitest';
import { recordUnifiedUsage, takeUnifiedUsage, formatUnifiedUsage } from './unifiedUsage';

describe('unifiedUsage registry', () => {
  it('records and takes per stage (take consumes)', () => {
    recordUnifiedUsage('scout', 100, 10, 110);
    expect(takeUnifiedUsage('scout')).toEqual({ input: 100, output: 10, total: 110 });
    expect(takeUnifiedUsage('scout')).toBeNull();
  });
  it('is case-insensitive and stage-isolated', () => {
    recordUnifiedUsage('Dietitian', 1, 2, 3);
    expect(takeUnifiedUsage('dietitian')).toEqual({ input: 1, output: 2, total: 3 });
    expect(takeUnifiedUsage('scout')).toBeNull();
  });
  it('formats the canonical log line', () => {
    expect(formatUnifiedUsage('scout', { input: 8, output: 1, total: 9 }))
      .toBe('[UnifiedLLM-Usage:scout] prompt=8 completion=1 total=9');
  });
});
