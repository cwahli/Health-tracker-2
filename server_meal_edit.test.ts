import { describe, it, expect } from 'vitest';
import {
  applyMealEdits,
  coalesceLegacyCommands,
  mealItemsHaveAtwaterCalories,
  extractSauceName,
} from './server_meal_edit';
import { compositionTileItems } from './src/utils/foodCompositionTiles';

function steakPlate() {
  return [
    {
      scoutIndex: 0,
      name: 'Sizzling Beef and Chicken Steak',
      canonicalDbName: 'Sizzling Beef and Chicken Steak',
      originalName: 'Sizzling Beef and Chicken Steak',
      weightGrams: 580,
      calories: 890,
      protein: 62,
      carbohydrates: 40,
      totalFat: 48,
      nutrients: { calories: 890, protein: 62, carbohydrates: 40, totalFat: 48, saturatedFat: 16, sodium: 1200 },
      sourceImageIndex: 1,
      boundingBox2D: [5, 5, 90, 90],
      dbSource: 'estimated',
      componentsDetailList: [
        { name: 'Beef and Chicken Steak', weightGrams: 250, calories: 520, protein: 48, carbohydrates: 2, totalFat: 36, nutrients: { calories: 520, protein: 48, carbohydrates: 2, totalFat: 36 } },
        { name: 'Black Pepper Sauce', weightGrams: 80, calories: 90, protein: 2, carbohydrates: 6, totalFat: 6, nutrients: { calories: 90, protein: 2, carbohydrates: 6, totalFat: 6 } },
        { name: 'Potato Wedges', weightGrams: 130, calories: 180, protein: 3, carbohydrates: 25, totalFat: 7, nutrients: { calories: 180, protein: 3, carbohydrates: 25, totalFat: 7 } },
        { name: 'Mixed Vegetables', weightGrams: 120, calories: 70, protein: 2, carbohydrates: 10, totalFat: 2, nutrients: { calories: 70, protein: 2, carbohydrates: 10, totalFat: 2 } },
      ],
    },
    {
      scoutIndex: 1,
      name: 'Sempol Ayam',
      canonicalDbName: 'Sempol Ayam',
      weightGrams: 80,
      calories: 180,
      protein: 11,
      carbohydrates: 15,
      totalFat: 8,
      nutrients: { calories: 180, protein: 11, carbohydrates: 15, totalFat: 8, saturatedFat: 2, sodium: 280 },
      sourceImageIndex: 3,
      boundingBox2D: [1, 2, 3, 4],
      dbSource: 'estimated',
    },
  ];
}

describe('applyMealEdits', () => {
  it('Q&A: empty commands leave the meal unchanged', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({ items, commands: [], userMessage: 'is this high protein?' });
    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].weightGrams).toBe(580);
  });

  it('replace_identity copies photo + weight and Atwaters the new estimate (tempeh, not this meal’s FDC)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is tempeh satay',
      commands: [{
        action: 'replace_identity',
        itemName: 'Sempol Ayam',
        newItemName: 'Tempeh Satay',
        estimate: { protein: 19, carbohydrates: 9, totalFat: 11, saturatedFat: 2, sodium: 220, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });
    const row = result.items.find((it) => /tempeh/i.test(it.name));
    expect(row).toBeTruthy();
    expect(row.sourceImageIndex).toBe(3);
    expect(row.boundingBox2D).toEqual([1, 2, 3, 4]);
    expect(row.weightGrams).toBe(80);
    expect(row.calories).toBeGreaterThan(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('split keeps unmentioned sides at saved grams and sauce as a component', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the beef and chicken is 100g of beef steak and 100g of chicken steak',
      commands: [{
        action: 'split_item',
        itemName: 'Sizzling Beef and Chicken Steak',
        into: [
          { name: 'Beef Steak', grams: 100, estimate: { protein: 27, carbohydrates: 0, totalFat: 8, saturatedFat: 3, sodium: 70, cookingMethod: 'grilled', foodType: 'protein' } },
          { name: 'Chicken Steak', grams: 100, estimate: { protein: 28, carbohydrates: 0, totalFat: 4, saturatedFat: 1, sodium: 65, cookingMethod: 'grilled', foodType: 'protein' } },
        ],
      }],
    });
    const names = result.items.map((it) => it.name);
    expect(names.some((n) => /beef steak/i.test(n))).toBe(true);
    expect(names.some((n) => /chicken steak/i.test(n))).toBe(true);
    const wedges = result.items.find((it) => /wedges/i.test(it.name));
    const veg = result.items.find((it) => /vegetable/i.test(it.name));
    expect(wedges?.weightGrams).toBe(130);
    expect(wedges?.role).toBe('component');
    expect(veg?.weightGrams).toBe(120);
    expect(veg?.role).toBe('component');
    const sauceFood = result.items.find((it) => /sauce/i.test(it.name) && it.role !== 'component');
    expect(sauceFood).toBeFalsy();
    const host = result.items.find((it) => Array.isArray(it.componentsDetailList) && it.componentsDetailList.some((c: any) => /sauce/i.test(c.name)));
    expect(host).toBeTruthy();
    expect(compositionTileItems(result.items).every((it) => it.role !== 'component')).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('coalesce remove+add of a composite into split, ignoring few-shot 80/100/70 side grams', () => {
    const items = steakPlate();
    const coalesced = coalesceLegacyCommands(
      [
        { action: 'remove_item', itemName: 'Sizzling Beef and Chicken Steak' },
        { action: 'add_item', itemName: 'Beef Steak', newWeightGrams: 100, estimate: { protein: 27, carbohydrates: 0, totalFat: 8 } },
        { action: 'add_item', itemName: 'Chicken Steak', newWeightGrams: 100, estimate: { protein: 28, carbohydrates: 0, totalFat: 4 } },
        { action: 'add_item', itemName: 'Black Pepper Sauce', newWeightGrams: 80 },
        { action: 'add_item', itemName: 'Potato Wedges', newWeightGrams: 100 },
        { action: 'add_item', itemName: 'Mixed Vegetables', newWeightGrams: 70 },
      ],
      items,
      'the beef and chicken is 100g of beef steak and 100g of chicken steak'
    );
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0].action).toBe('split_item');
    const intoNames = (coalesced[0].into || []).map((p) => p.name.toLowerCase());
    expect(intoNames.some((n) => n.includes('beef'))).toBe(true);
    expect(intoNames.some((n) => n.includes('chicken'))).toBe(true);
    expect(intoNames.some((n) => n.includes('wedges'))).toBe(false);
    expect(intoNames.some((n) => n.includes('vegetable'))).toBe(false);
  });

  it('add_item with scout-shaped estimate never inherits 0 kcal (seitan, not this meal)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'also add 90g seitan',
      commands: [{
        action: 'add_item',
        itemName: 'Seitan',
        newWeightGrams: 90,
        estimate: { protein: 22, carbohydrates: 8, totalFat: 2, saturatedFat: 0.4, sodium: 180, cookingMethod: 'pan_fried', foodType: 'protein' },
      }],
    });
    const seitan = result.items.find((it) => /seitan/i.test(it.name));
    expect(seitan).toBeTruthy();
    expect(seitan.calories).toBeGreaterThan(0);
    expect(seitan.sourceImageIndex).toBeNull();
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('set_count is a piece annotation and does not double already-weighed grams (tempeh, not this meal)', async () => {
    const items = steakPlate();
    items[1].name = 'Tempeh Satay';
    items[1].canonicalDbName = 'Tempeh Satay';
    const result = await applyMealEdits({
      items,
      userMessage: 'that tempeh is 2 pieces',
      commands: [{ action: 'set_count', itemName: 'Tempeh Satay', count: 2 }],
    });
    const row = result.items.find((it) => /tempeh/i.test(it.name));
    expect(row.weightGrams).toBe(80);
    expect(row.count).toBe(2);
  });

  it('replace_identity then set_count keeps the saved portion (fish cake skewer)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is 2 fish cake skewers',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Sempol Ayam',
          newItemName: 'Fish Cake Skewer',
          newWeightGrams: 85,
          estimate: { protein: 10, carbohydrates: 15, totalFat: 4, saturatedFat: 1.2, sodium: 280, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_count', itemName: 'Fish Cake Skewer', count: 2 },
      ],
    });
    const row = result.items.find((it) => /fish cake/i.test(it.name));
    expect(row.weightGrams).toBe(85);
    expect(row.count).toBe(2);
    expect(row.calories).toBeGreaterThan(0);
    expect(row.calories).toBeLessThan(200);
  });

  it('split of meat-with-sauce leftover is condiment grams, sides stay components (seitan plate)', async () => {
    expect(extractSauceName('Seitan Cutlet with Chili Gravy')).toBe('Chili Gravy');
    const items = [{
      scoutIndex: 0,
      name: 'Seitan Cutlet Plate',
      canonicalDbName: 'Seitan Cutlet Plate',
      weightGrams: 500,
      calories: 600,
      protein: 40,
      carbohydrates: 50,
      totalFat: 20,
      nutrients: { calories: 600, protein: 40, carbohydrates: 50, totalFat: 20 },
      sourceImageIndex: 2,
      dbSource: 'estimated',
      componentsDetailList: [
        {
          name: 'Seitan Cutlet with Chili Gravy',
          weightGrams: 250,
          calories: 330,
          protein: 42,
          carbohydrates: 8,
          totalFat: 14.5,
          nutrients: { calories: 330, protein: 42, carbohydrates: 8, totalFat: 14.5 },
        },
        { name: 'Sweet Potato Wedges', weightGrams: 130, calories: 167, protein: 3, carbohydrates: 30, totalFat: 3.9, nutrients: { calories: 167, protein: 3, carbohydrates: 30, totalFat: 3.9 } },
        { name: 'Garden Vegetables', weightGrams: 120, calories: 116, protein: 3.5, carbohydrates: 16, totalFat: 4.2, nutrients: { calories: 116, protein: 3.5, carbohydrates: 16, totalFat: 4.2 } },
      ],
    }];
    const result = await applyMealEdits({
      items,
      userMessage: 'the seitan is 100g seitan steak and 100g tempeh steak',
      commands: [{
        action: 'split_item',
        itemName: 'Seitan Cutlet Plate',
        into: [
          { name: 'Seitan Steak', grams: 100, role: 'food', estimate: { protein: 26, carbohydrates: 0, totalFat: 11, cookingMethod: 'pan_fried', foodType: 'protein' } },
          { name: 'Tempeh Steak', grams: 100, role: 'food', estimate: { protein: 31, carbohydrates: 0, totalFat: 3.6, cookingMethod: 'pan_fried', foodType: 'protein' } },
        ],
      }],
    });
    const gravy = result.items.find((it) => /gravy/i.test(it.name));
    expect(gravy).toBeTruthy();
    expect(gravy.role).toBe('component');
    expect(gravy.weightGrams).toBe(50);
    expect(gravy.protein).toBeLessThanOrEqual(2);
    const wedges = result.items.find((it) => /wedges/i.test(it.name));
    const veg = result.items.find((it) => /garden/i.test(it.name));
    expect(wedges?.role).toBe('component');
    expect(wedges?.weightGrams).toBe(130);
    expect(veg?.role).toBe('component');
    expect(veg?.weightGrams).toBe(120);
    const tiles = compositionTileItems(result.items);
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => t.role !== 'component')).toBe(true);
    expect(result.weightGrams).toBe(500);
  });

  it('unsweetened twice applies once', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Sweet Iced Tea',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 300,
        foodType: 'beverage',
        calories: 90,
        protein: 0,
        carbohydrates: 22,
        totalFat: 0,
        nutrients: { calories: 90, protein: 0, carbohydrates: 22, totalFat: 0, sugar: 22, addedSugar: 22, sodium: 10 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [
        { action: 'update_modifier', itemName: 'Sweet Iced Tea', modifier: 'unsweetened' },
        { action: 'update_modifier', itemName: 'Sweet Iced Tea', modifier: 'unsweetened', newItemName: 'Unsweetened Iced Tea' },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
  });
});

describe('evidence job outer check (frozen example, class tests above)', () => {
  it('T2 commands keep 85g count=2, sauce remainder, nested sides, 1635g', async () => {
    const t1 = [
      { scoutIndex: 0, name: 'Soft Serve Ice Cream Cone', canonicalDbName: 'Soft Serve Ice Cream Cone', weightGrams: 120, calories: 253, protein: 4.5, nutrients: { calories: 253, protein: 4.5, totalFat: 8.3, carbohydrates: 40, sodium: 90 }, sourceImageIndex: 0 },
      { scoutIndex: 1, name: 'Crispy Fried Chicken', canonicalDbName: 'Crispy Fried Chicken', weightGrams: 160, calories: 283, protein: 28, nutrients: { calories: 283, protein: 28, totalFat: 14.5, carbohydrates: 10, sodium: 480 }, sourceImageIndex: 1 },
      { scoutIndex: 2, name: 'Sempol Ayam', canonicalDbName: 'Sempol Ayam', weightGrams: 85, calories: 162, protein: 9.5, nutrients: { calories: 162, protein: 9.5, totalFat: 7.5, carbohydrates: 14, sodium: 310 }, sourceImageIndex: 2 },
      { scoutIndex: 3, name: 'Hemaviton C1000 Orange Drink', canonicalDbName: 'Hemaviton C1000 Orange Drink', weightGrams: 330, calories: 100, protein: 0, nutrients: { calories: 100, protein: 0, totalFat: 0, carbohydrates: 25, sodium: 45 }, sourceImageIndex: 3 },
      {
        scoutIndex: 4,
        name: 'Beef and Chicken Steak with Wedges and Mixed Vegetables',
        canonicalDbName: 'Beef and Chicken Steak with Wedges and Mixed Vegetables',
        weightGrams: 500,
        calories: 608,
        protein: 48.5,
        nutrients: { calories: 608, protein: 48.5, totalFat: 22.6, carbohydrates: 54, sodium: 1070 },
        sourceImageIndex: 4,
        components: [
          { name: 'Beef and Chicken Steak with Black Pepper Sauce', weightGrams: 250, calories: 330.5, protein: 42, nutrients: { calories: 330.5, protein: 42, totalFat: 14.5, carbohydrates: 8 } },
          { name: 'Potato Wedges', weightGrams: 130, calories: 167.1, protein: 3, nutrients: { calories: 167.1, protein: 3, totalFat: 3.9, carbohydrates: 30 } },
          { name: 'Mixed Vegetables with Mayonnaise', weightGrams: 120, calories: 115.8, protein: 3.5, nutrients: { calories: 115.8, protein: 3.5, totalFat: 4.2, carbohydrates: 16 } },
        ],
      },
      { scoutIndex: 5, name: 'Iced Tea', canonicalDbName: 'Iced Tea', weightGrams: 300, calories: 74, protein: 0, foodType: 'beverage', nutrients: { calories: 74, protein: 0, totalFat: 0, carbohydrates: 18.5, sugar: 18, addedSugar: 18, sodium: 10 }, sourceImageIndex: 4 },
      { scoutIndex: 6, name: 'Sosis Bakar / Cumi Bakar Tusuk', canonicalDbName: 'Sosis Bakar / Cumi Bakar Tusuk', weightGrams: 140, calories: 201, protein: 18, nutrients: { calories: 201, protein: 18, totalFat: 9, carbohydrates: 12, sodium: 520 }, sourceImageIndex: 5 },
    ];
    const result = await applyMealEdits({
      items: t1,
      userMessage: 'The sempol ayam is 2 otak otak, the beef and chicken is 100g of beef steak and 100g of chicken steak, the tea is unsweetened and the sos bakar is fried chicken fillet',
      commands: [
        { action: 'replace_identity', itemName: 'Sempol Ayam', newItemName: 'Otak-Otak', newWeightGrams: 85, estimate: { protein: 10, carbohydrates: 15, totalFat: 4, saturatedFat: 1.2, sodium: 280, cookingMethod: 'grilled', foodType: 'protein' } },
        { action: 'set_count', itemName: 'Otak-Otak', count: 2 },
        { action: 'split_item', itemName: 'Beef and Chicken Steak with Wedges and Mixed Vegetables', into: [
          { name: 'Beef Steak', grams: 100, role: 'food', estimate: { protein: 26, carbohydrates: 0, totalFat: 11, saturatedFat: 4.5, sodium: 70, cookingMethod: 'pan_fried', foodType: 'protein' } },
          { name: 'Chicken Steak', grams: 100, role: 'food', estimate: { protein: 31, carbohydrates: 0, totalFat: 3.6, saturatedFat: 1.0, sodium: 75, cookingMethod: 'pan_fried', foodType: 'protein' } },
        ] },
        { action: 'set_modifier', itemName: 'Iced Tea', modifier: 'unsweetened', newItemName: 'Unsweetened Iced Tea' },
        { action: 'replace_identity', itemName: 'Sosis Bakar / Cumi Bakar Tusuk', newItemName: 'Fried Chicken Fillet', newWeightGrams: 140, estimate: { protein: 29.4, carbohydrates: 11.2, totalFat: 19.6, saturatedFat: 5.5, sodium: 520, cookingMethod: 'deep_fried', foodType: 'protein' } },
      ],
    });
    const otak = result.items.find((it) => /otak/i.test(it.name));
    expect(otak.weightGrams).toBe(85);
    expect(otak.count).toBe(2);
    const sauce = result.items.find((it) => /pepper sauce/i.test(it.name));
    expect(sauce?.role).toBe('component');
    expect(sauce?.weightGrams).toBe(50);
    expect(result.items.find((it) => /wedges/i.test(it.name))?.role).toBe('component');
    expect(result.items.find((it) => /vegetable/i.test(it.name))?.role).toBe('component');
    expect(result.weightGrams).toBe(1635);
    const tiles = compositionTileItems(result.items);
    expect(tiles.length).toBeLessThanOrEqual(8);
    expect(tiles.some((t) => /wedges|sauce|vegetable/i.test(t.name || t.originalName || ''))).toBe(false);
  });

  it('set_modifier propagates modified name and nutrients to nested components/componentsDetailList', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        weightGrams: 350,
        calories: 104,
        protein: 0,
        foodType: 'beverage',
        nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 },
        components: [
          {
            name: 'Sweet Iced Tea',
            weightGrams: 350,
            calories: 104,
            nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 }
          }
        ],
        componentsDetailList: [
          {
            name: 'Sweet Iced Tea',
            weightGrams: 350,
            calories: 104,
            nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 }
          }
        ]
      }
    ];

    const result = await applyMealEdits({
      items,
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' }
      ]
    });

    const tea = result.items[0];
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.nutrients.calories).toBe(0);
    expect(tea.nutrients.sugar).toBe(0);

    // Verify propagation to components
    expect(tea.components[0].name).toBe('Unsweetened Iced Tea');
    expect(tea.components[0].nutrients.calories).toBe(0);
    expect(tea.components[0].nutrients.sugar).toBe(0);

    // Verify propagation to componentsDetailList
    expect(tea.componentsDetailList[0].name).toBe('Unsweetened Iced Tea');
    expect(tea.componentsDetailList[0].nutrients.calories).toBe(0);
    expect(tea.componentsDetailList[0].nutrients.sugar).toBe(0);
  });
});
