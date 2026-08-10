import { describe, it, expect } from 'vitest';
import { consolidateMeal } from '../consolidate';
import { MealBuild, MealFoodItem } from '../types';

describe('consolidateMeal', () => {
  it('preserves locks, label, and components when patch omits them', () => {
    const initial: MealBuild = {
      id: '1', schemaVersion: 1, version: 1, mode: 'new_log',
      items: [
        {
          itemId: 'item1', scoutIndex: 0, name: 'Apple',
          rawNutritionLabel: { calories: 95 },
          lockedNutrientKeys: ['calories'],
          componentsDetailList: [{ name: 'Apple Core' }]
        }
      ],
      nutrients: {}
    };
    
    const patch = {
      items: [
        { itemId: 'item1', name: 'Green Apple' } // omits critical fields
      ]
    };
    
    const result = consolidateMeal(initial, patch, 'dietitian');
    expect(result.items[0].name).toBe('Green Apple');
    expect(result.items[0].rawNutritionLabel).toEqual({ calories: 95 });
    expect(result.items[0].lockedNutrientKeys).toEqual(['calories']);
    expect(result.items[0].componentsDetailList).toEqual([{ name: 'Apple Core' }]);
  });
  
  it('partial item stays partial, no invented components', () => {
    const initial: MealBuild = {
      id: '2', schemaVersion: 1, version: 1, mode: 'new_log',
      items: [
        { itemId: 'item2', scoutIndex: 0, name: 'Banana', rawNutritionLabel: { calories: 105 } }
      ],
      nutrients: {}
    };
    
    const result = consolidateMeal(initial, { items: [{ itemId: 'item2', estimatedWeightGrams: 120 }] }, 'calc');
    expect(result.items[0].estimatedWeightGrams).toBe(120);
    expect(result.items[0].componentsDetailList).toBeUndefined(); // no invented components
  });
  
  it('ledger is append-only', () => {
    const initial: MealBuild = {
      id: '3', schemaVersion: 1, version: 1, mode: 'new_log', items: [], nutrients: {},
      stageLedger: [{ stageKey: '1_scout_1', stage: 'scout', attempt: 1, timestamp: '123', status: 'success' }]
    };
    
    const result = consolidateMeal(initial, {}, 'dietitian', { stageKey: '1_dietitian_1' });
    expect(result.stageLedger?.length).toBe(2);
    expect(result.stageLedger?.[1].stageKey).toBe('1_dietitian_1');
  });
  
  it('delete item + stage patch resends it -> stays deleted (zombie)', () => {
    const initial: MealBuild = {
      id: '4', schemaVersion: 1, version: 1, mode: 'new_log',
      items: [{ itemId: 'delete-me', name: 'Bad' }],
      deletedItemIds: ['delete-me'],
      nutrients: {}
    };
    
    const result = consolidateMeal(initial, { items: [{ itemId: 'delete-me', name: 'Still bad' }] }, 'calc');
    expect(result.items.find(i => i.itemId === 'delete-me')).toBeUndefined();
  });
  
  it('weight +50% -> staleDietitianNarrative true', () => {
    const initial: MealBuild = {
      id: '5', schemaVersion: 1, version: 1, mode: 'new_log',
      items: [{ itemId: 'w1', name: 'Beef', weightGrams: 100 }],
      nutrients: {}
    };
    
    const result = consolidateMeal(initial, { items: [{ itemId: 'w1', weightGrams: 150 }] }, 'user_edit');
    expect(result.staleDietitianNarrative).toBe(true);
  });
});
