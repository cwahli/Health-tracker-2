import { describe, it, expect } from 'vitest';
import { deduceSugarBreakdown } from './server_sugar_engine.js';

describe('BUG-06 bakery added sugar', () => {
  it('treats cinnamon roll + cane sugar glaze as added sugar, not 0.2g', () => {
    const r = deduceSugarBreakdown({
      totalSugar: 37.4,
      addedSugarPrinted: null,
      carbohydrates: 97,
      totalFibre: 3,
      physicalForm: 'SOLID_GRAIN_STARCH',
      foodName: 'Cinnamon roll',
      ingredientsList: 'enriched wheat flour, unsalted butter, cane sugar, ground cinnamon',
    });
    expect(r.addedSugar).toBeGreaterThan(20);
    expect(r.addedSugar).toBeLessThanOrEqual(37.4);
  });

  it('still zeros added sugar on unsweetened grain (rice)', () => {
    const r = deduceSugarBreakdown({
      totalSugar: 0.2,
      foodName: 'cooked white rice',
      physicalForm: 'SOLID_GRAIN_STARCH',
    });
    expect(r.addedSugar).toBe(0);
  });
});
