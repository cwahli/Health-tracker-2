import { describe, it, expect } from 'vitest';
import { buildDataSanitizePlan, applyDataSanitizePlan } from './dataSanitize';

describe('buildDataSanitizePlan', () => {
  it('proposes fixing 195 total cholesterol and merging food dups', () => {
    const plan = buildDataSanitizePlan({
      profile: {},
      biomarkers: { total_cholesterol: 195 },
      biomarkerHistory: [
        { id: 'l1', date: '08-08-2026', biomarkers: { total_cholesterol: 195 } },
        { id: 'l2', date: '02-08-2026', biomarkers: { total_cholesterol: 6.1 } },
      ],
      foodLogs: [
        {
          id: 'f1',
          name: 'Oatmeal with Fruit and Fresh Produce Selection',
          date: '2026-08-06',
          nutrients: { calories: 405 },
        },
        {
          id: 'f2',
          name: 'Oatmeal with Fruit and Fresh Produce Selection',
          date: '06-08-2026',
          nutrients: { calories: 405 },
        },
      ],
    });
    expect(plan.proposals.some((p) => p.kind === 'fix_value' || p.kind === 'drop_value')).toBe(true);
    expect(plan.proposals.some((p) => p.kind === 'merge_food')).toBe(true);
  });

  it('applies selected food merges', () => {
    const plan = buildDataSanitizePlan({
      profile: {},
      biomarkers: {},
      biomarkerHistory: [],
      foodLogs: [
        { id: 'f1', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '2026-08-04', nutrients: { calories: 1176 } },
        { id: 'f2', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '04-08-2026', nutrients: { calories: 1176 } },
      ],
    });
    const merge = plan.proposals.find((p) => p.kind === 'merge_food');
    expect(merge).toBeTruthy();
    const result = applyDataSanitizePlan(plan, new Set([merge!.id]), {
      profile: {},
      biomarkers: {},
      biomarkerHistory: [],
      foodLogs: [
        { id: 'f1', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '2026-08-04', nutrients: { calories: 1176 } },
        { id: 'f2', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '04-08-2026', nutrients: { calories: 1176 } },
      ],
    });
    expect(result.foodLogs).toHaveLength(1);
  });
});
