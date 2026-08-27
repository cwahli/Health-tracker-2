import { describe, it, expect } from 'vitest';
import { scaleMealPortion, scaleSingleDishPortion } from './portionUtils';

describe('portionUtils', () => {
  const sampleLog: any = {
    weightGrams: 200,
    calories: 400,
    portionRatio: 1.0,
    portionAccepted: false,
    message: 'This meal provides 400 calories and 30g of protein.',
    nutrients: {
      calories: 400,
      proteinGrams: 30,
      carbsGrams: 40,
      fatGrams: 15,
    },
    itemsBreakdown: [
      {
        name: 'Grilled Chicken',
        weightGrams: 150,
        calories: 250,
        portionRatio: 1.0,
        nutrients: {
          calories: 250,
          proteinGrams: 25,
          carbsGrams: 0,
          fatGrams: 5,
        },
      },
      {
        name: 'Steamed Rice',
        weightGrams: 50,
        calories: 150,
        portionRatio: 1.0,
        nutrients: {
          calories: 150,
          proteinGrams: 5,
          carbsGrams: 40,
          fatGrams: 10,
        },
      },
    ],
  };

  it('scales total meal portion to custom ratio correctly', () => {
    // 1.5 ratio scaling (300g target)
    const scaled = scaleMealPortion(sampleLog, 1.5);

    expect(scaled.portionRatio).toBe(1.5);
    expect(scaled.weightGrams).toBe(300);
    expect(scaled.nutrients?.calories).toBe(600); // 400 * 1.5
    expect(scaled.itemsBreakdown[0].weightGrams).toBe(225); // 150 * 1.5
    expect(scaled.itemsBreakdown[1].weightGrams).toBe(75); // 50 * 1.5
    expect(scaled.receiptTable).toContain('GRAND MEAL TOTAL - 300g');
    expect(scaled.receiptTable).toContain('225g');
    expect(scaled.message).toContain('600 calories');
    expect(scaled.message).toContain('45g of protein');
  });

  it('scales single dish portion independently', () => {
    // Scale dish 0 (Grilled Chicken) to 2.0 ratio (300g)
    const scaled = scaleSingleDishPortion(sampleLog, 0, 2.0);

    expect(scaled.itemsBreakdown[0].portionRatio).toBe(2.0);
    expect(scaled.itemsBreakdown[0].weightGrams).toBe(300);
    expect(scaled.itemsBreakdown[0].calories).toBe(500); // 250 * 2
    expect(scaled.itemsBreakdown[1].weightGrams).toBe(50); // unchanged
    expect(scaled.weightGrams).toBe(350); // 300 + 50
    expect(scaled.receiptTable).toContain('300g');
    expect(scaled.receiptTable).toContain('GRAND MEAL TOTAL - 350g');
  });
});

