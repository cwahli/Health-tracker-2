import { describe, it, expect } from 'vitest';
import { buildScoutPersonalizationBlock } from './scoutInstructions';

describe('scout personalization special-case block', () => {
  it('returns empty when nothing is at risk (base prompt untouched)', () => {
    expect(buildScoutPersonalizationBlock({})).toBe('');
    expect(buildScoutPersonalizationBlock({ biomarkersNeedingImprovement: [] })).toBe('');
    expect(buildScoutPersonalizationBlock({ biomarkersNeedingImprovement: null })).toBe('');
  });

  it('names at-risk biomarkers with direction, capped at five', () => {
    const risks = Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, direction: 'high' }));
    const out = buildScoutPersonalizationBlock({ biomarkersNeedingImprovement: risks });
    expect(out).toMatch(/M0 \(high\)/);
    expect(out).toMatch(/M4 \(high\)/);
    expect(out).not.toMatch(/M5/);
  });

  it('handles string biomarkers from the direct submit path', () => {
    const out = buildScoutPersonalizationBlock({
      biomarkersNeedingImprovement: ['LDL is HIGH (170 mg/dL, normal range: <100)'] as any,
    });
    expect(out).toMatch(/at-risk: LDL/);
  });

  it('points budgets at the averaged target status, shapes verdict/advice only', () => {
    const out = buildScoutPersonalizationBlock({
      biomarkersNeedingImprovement: [{ name: 'LDL' }],
    });
    expect(out).toMatch(/NUTRITIONAL TARGET STATUS/);
    expect(out).toMatch(/verdict\/advice only/);
    expect(out).toMatch(/never identity or weights/);
    expect(out).not.toMatch(/remaining today/);
  });
});
