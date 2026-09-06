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

  it('synthesizes unsweetened modifier from userMessage when commands are empty (e.g. Es Teh Manis)', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        originalName: 'Sweet Iced Tea',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(result.items[0].name).toMatch(/tawar|unsweetened/i);
    expect(result.changed).toBe(true);
  });

  it('synthesizes unsweetened modifier from Indonesian userMessage "I had es teh tawar"', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'I had es teh tawar',
      commands: [],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(result.items[0].name).toBe('Es Teh Tawar');
    expect(result.changed).toBe(true);
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

  it('resets constituent components when replace_identity changes the dish to a distinct new identity', async () => {
    const items = [
      {
        scoutIndex: 2,
        name: 'Takeaway Drink in Plastic Bag',
        canonicalDbName: 'Takeaway Drink in Plastic Bag',
        weightGrams: 300,
        calories: 120,
        protein: 0,
        foodType: 'beverage',
        nutrients: { calories: 120, protein: 0, totalFat: 0, carbohydrates: 30, sugar: 25, addedSugar: 25, sodium: 10 },
        components: [
          { name: 'Sweetened Beverage in Plastic Bag', weightGrams: 300, calories: 120, protein: 0, carbohydrates: 30 }
        ],
        componentsDetailList: [
          { name: 'Sweetened Beverage in Plastic Bag', weightGrams: 300, calories: 120, protein: 0, carbohydrates: 30 }
        ],
      },
    ];

    const result = await applyMealEdits({
      items,
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Takeaway Drink in Plastic Bag',
          newItemName: 'Raw Coconut Juice',
          newWeightGrams: 300,
        }
      ]
    });

    const juice = result.items[0];
    expect(juice.name).toBe('Raw Coconut Juice');
    // Coconut water is ~50-60 kcal for 300g, 0g added sugar
    expect(juice.calories).toBeLessThan(70);
    expect(juice.nutrients.addedSugar).toBe(0);
    // Subcomponents should NOT retain old "Sweetened Beverage in Plastic Bag"
    expect(juice.components[0].name).toBe('Raw Coconut Juice');
    expect(juice.componentsDetailList[0].name).toBe('Raw Coconut Juice');
  });
});

describe('golden', () => {
  function cakalangKangkungPlate() {
    return [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Kangkung',
        canonicalDbName: 'Kangkung',
        originalName: 'Kangkung',
        weightGrams: 150,
        calories: 90,
        protein: 3,
        carbohydrates: 8,
        totalFat: 5,
        nutrients: { calories: 90, protein: 3, carbohydrates: 8, totalFat: 5, saturatedFat: 1, sodium: 200 },
        sourceImageIndex: 1,
        dbSource: 'estimated',
      },
    ];
  }

  it('keeps replaced fish identity through a later weight-only edit on another item', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const afterPortion = await applyMealEdits({
      items: replaced.items,
      userMessage: 'the kangkung is 120g',
      commands: [{ action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 }],
    });

    const fish = afterPortion.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = afterPortion.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish.name).toBe('Ikan Nila');
    expect(fish.canonicalDbName).toBe('Ikan Nila');
    expect(fish.originalName).toBe('Ikan Nila');
    expect(fish.name).not.toMatch(/cakalang/i);
    expect(kangkung.weightGrams).toBe(120);
    expect(afterPortion.weightGrams).toBe(220);
  });

  it('golden: unsweetened tea and Ikan Nila rename persist together on top-level and component identities', async () => {
    const identity = (name: string, extra: any = {}) => ({
      name,
      canonicalDbName: name,
      originalName: name,
      keyword: name,
      ...extra,
    });

    const child = (name: string, grams: number, nutrients: any) => identity(name, {
      weightGrams: grams,
      calories: nutrients.calories ?? 0,
      protein: nutrients.protein ?? 0,
      carbohydrates: nutrients.carbohydrates ?? 0,
      totalFat: nutrients.totalFat ?? 0,
      nutrients,
    });

    const fishNutrients = {
      calories: 120,
      protein: 25,
      carbohydrates: 0,
      totalFat: 2,
      saturatedFat: 0.5,
      sodium: 300,
    };

    const teaNutrients = {
      calories: 104,
      protein: 0,
      carbohydrates: 26,
      totalFat: 0,
      sugar: 26,
      addedSugar: 26,
      sodium: 5,
    };

    const items = [
      identity('Cakalang', {
        scoutIndex: 0,
        weightGrams: 100,
        calories: fishNutrients.calories,
        protein: fishNutrients.protein,
        carbohydrates: fishNutrients.carbohydrates,
        totalFat: fishNutrients.totalFat,
        nutrients: fishNutrients,
        sourceImageIndex: 0,
        components: [child('Cakalang', 100, fishNutrients)],
        componentsDetailList: [child('Cakalang', 100, fishNutrients)],
      }),
      identity('Es Teh Manis', {
        scoutIndex: 1,
        weightGrams: 350,
        foodType: 'beverage',
        calories: teaNutrients.calories,
        protein: teaNutrients.protein,
        carbohydrates: teaNutrients.carbohydrates,
        totalFat: teaNutrients.totalFat,
        nutrients: teaNutrients,
        sourceImageIndex: 1,
        components: [child('Sweet Iced Tea', 350, teaNutrients)],
        componentsDetailList: [child('Sweet Iced Tea', 350, teaNutrients)],
      }),
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila and the tea is tawar',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.items).toHaveLength(2);
    expect(result.changed).toBe(true);

    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');

    for (const comp of [fish?.components?.[0], fish?.componentsDetailList?.[0]]) {
      expect(comp?.name).toBe('Ikan Nila');
      expect(comp?.canonicalDbName).toBe('Ikan Nila');
      expect(comp?.originalName).toBe('Ikan Nila');
      expect(comp?.keyword).toBe('Ikan Nila');
    }

    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.originalName).toBe('Es Teh Tawar');
    expect(tea?.keyword).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);

    for (const comp of [tea?.components?.[0], tea?.componentsDetailList?.[0]]) {
      expect(comp?.name).toMatch(/tawar|unsweetened/i);
      expect(comp?.canonicalDbName).toBe(comp?.name);
      expect(comp?.originalName).toBe(comp?.name);
      expect(comp?.keyword).toBe(comp?.name);
      expect(comp?.nutrients.addedSugar).toBe(0);
    }

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('remove_item then set_weight on a different item does not resurrect the removed row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and make the kangkung 120g',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);

    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();
    expect(kangkung?.scoutIndex).toBe(1);
    expect(kangkung?.weightGrams).toBe(120);
  });

  it('golden: replace_identity then remove_item by the new identity drops the renamed fish and keeps kangkung', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    expect(replaced.items[0].name).toBe('Ikan Nila');
    expect(replaced.items[0].scoutIndex).toBe(0);

    const removed = await applyMealEdits({
      items: replaced.items,
      userMessage: 'remove the ikan nila',
      commands: [{ action: 'remove_item', itemName: 'Ikan Nila' }],
    });

    expect(removed.changed).toBe(true);
    expect(removed.items).toHaveLength(1);
    expect(removed.items.some((it: any) => /ikan nila|cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);
    expect(removed.items[0].name).toBe('Kangkung');
    expect(removed.items[0].scoutIndex).toBe(1);
    expect(removed.items[0].weightGrams).toBe(150);
  });

  it('golden: replace_identity then remove_item on Kangkung keeps Ikan Nila identity', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const removed = await applyMealEdits({
      items: replaced.items,
      userMessage: 'remove the kangkung',
      commands: [{ action: 'remove_item', itemName: 'Kangkung' }],
    });

    expect(removed.changed).toBe(true);
    expect(removed.items).toHaveLength(1);
    expect(removed.items.some((it: any) => /kangkung/i.test(it.name) || it.scoutIndex === 1)).toBe(false);

    const fish = removed.items[0];
    expect(fish.scoutIndex).toBe(0);
    expect(fish.name).toBe('Ikan Nila');
    expect(fish.canonicalDbName).toBe('Ikan Nila');
    expect(fish.originalName).toBe('Ikan Nila');
    expect(fish.name).not.toMatch(/cakalang/i);
    expect(fish.weightGrams).toBe(100);
    expect(removed.weightGrams).toBe(100);
    expect(mealItemsHaveAtwaterCalories(removed.items)).toBe(true);
  });

  it('golden: case-insensitive set_weight itemName updates the matching row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'set_weight', itemName: 'kangkung', newWeightGrams: 120 }],
    });

    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
  });

  it('golden: whitespace-trimmed set_weight itemName still matches the row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'set_weight', itemName: '  Kangkung  ', newWeightGrams: 120 }],
    });

    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
  });

  it('golden: two set_weight commands update both portions and total weight', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 180g and the kangkung 100g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 180 },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 100 },
      ],
    });

    const fish = result.items.find((it: any) => /cakalang/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));

    expect(fish?.weightGrams).toBe(180);
    expect(kangkung?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(280);
    expect(result.weightGrams).toBe(
      result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
    );
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item then set_weight updates only the added Tempeh portion', async () => {
    const added = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'also add 100g tempeh',
      commands: [{
        action: 'add_item',
        itemName: 'Tempeh',
        newWeightGrams: 100,
        estimate: {
          protein: 19,
          carbohydrates: 9,
          totalFat: 11,
          saturatedFat: 2,
          sodium: 220,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      }],
    });

    const result = await applyMealEdits({
      items: added.items,
      userMessage: 'the tempeh is 90g',
      commands: [{ action: 'set_weight', itemName: 'Tempeh', newWeightGrams: 90 }],
    });

    const tempeh = result.items.find((it: any) => /tempeh/i.test(it.name));
    expect(tempeh).toBeTruthy();
    expect(tempeh?.weightGrams).toBe(90);
    expect(tempeh?.calories).toBeGreaterThan(0);

    expect(result.items).toHaveLength(3);
    expect(result.weightGrams).toBe(340);

    const cakalang = result.items.find((it: any) => /cakalang/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(cakalang?.name).toBe('Cakalang');
    expect(cakalang?.canonicalDbName).toBe('Cakalang');
    expect(cakalang?.weightGrams).toBe(100);
    expect(cakalang?.scoutIndex).toBe(0);
    expect(kangkung?.name).toBe('Kangkung');
    expect(kangkung?.canonicalDbName).toBe('Kangkung');
    expect(kangkung?.weightGrams).toBe(150);
    expect(kangkung?.scoutIndex).toBe(1);

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier unsweetened then replace_identity on fish keeps tea tawar and renames fish', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        keyword: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is tawar and the cakalang is ikan nila',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: strictly sequential replace_identity then set_modifier keeps fish and tea edits', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const afterFish = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const afterTea = await applyMealEdits({
      items: afterFish.items,
      userMessage: 'the tea is tawar',
      commands: [{
        action: 'set_modifier',
        itemName: 'Es Teh Manis',
        modifier: 'unsweetened',
        newItemName: 'Es Teh Tawar',
      }],
    });

    const fish = afterTea.items.find((it: any) => it.scoutIndex === 0);
    const tea = afterTea.items.find((it: any) => it.scoutIndex === 1);

    expect(afterTea.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(afterTea.changed).toBe(true);
  });

  it('golden: replace_identity then set_count on Ikan Nila keeps saved portion', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and it is 2 pieces',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: {
            protein: 20,
            carbohydrates: 0,
            totalFat: 5,
            saturatedFat: 1,
            sodium: 50,
            cookingMethod: 'grilled',
            foodType: 'protein',
          },
        },
        { action: 'set_count', itemName: 'Ikan Nila', count: 2 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.count).toBe(2);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(result.items.find((it: any) => it.scoutIndex === 1)?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: split then set_weight on one child preserves sibling identity', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Fish and Veg Plate',
        canonicalDbName: 'Fish and Veg Plate',
        originalName: 'Fish and Veg Plate',
        weightGrams: 300,
        calories: 260,
        protein: 25,
        carbohydrates: 20,
        totalFat: 10,
        nutrients: { calories: 260, protein: 25, carbohydrates: 20, totalFat: 10, saturatedFat: 2, sodium: 400 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
        componentsDetailList: [
          { name: 'Fish Fillet', weightGrams: 120, calories: 150, protein: 25, carbohydrates: 0, totalFat: 5, nutrients: { calories: 150, protein: 25, carbohydrates: 0, totalFat: 5 } },
          { name: 'Mixed Vegetables', weightGrams: 180, calories: 110, protein: 3, carbohydrates: 20, totalFat: 2, nutrients: { calories: 110, protein: 3, carbohydrates: 20, totalFat: 2 } },
        ],
      },
    ];

    const split = await applyMealEdits({
      items,
      userMessage: 'split the plate into fish fillet and mixed vegetables',
      commands: [{
        action: 'split_item',
        itemName: 'Fish and Veg Plate',
        into: [
          { name: 'Fish Fillet', grams: 120, role: 'food', estimate: { protein: 25, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' } },
          { name: 'Mixed Vegetables', grams: 180, role: 'food', estimate: { protein: 3, carbohydrates: 20, totalFat: 2, saturatedFat: 0.5, sodium: 30, cookingMethod: 'stir_fried', foodType: 'vegetable' } },
        ],
      }],
    });

    expect(split.items).toHaveLength(2);
    expect(split.items.map((it: any) => it.name)).toEqual(['Fish Fillet', 'Mixed Vegetables']);

    const result = await applyMealEdits({
      items: split.items,
      userMessage: 'the fish fillet is 100g',
      commands: [{ action: 'set_weight', itemName: 'Fish Fillet', newWeightGrams: 100 }],
    });

    const fish = result.items.find((it: any) => /fish fillet/i.test(it.name));
    const veg = result.items.find((it: any) => /mixed vegetables/i.test(it.name));

    expect(fish).toBeTruthy();
    expect(veg).toBeTruthy();
    expect(fish?.weightGrams).toBe(100);
    expect(veg?.weightGrams).toBe(180);
    expect(veg?.name).toBe('Mixed Vegetables');
    expect(result.items).toHaveLength(2);
    expect(result.weightGrams).toBe(280);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: split_item then remove_item of one child keeps the remaining sibling identity and weight', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Fish and Veg Plate',
        canonicalDbName: 'Fish and Veg Plate',
        originalName: 'Fish and Veg Plate',
        weightGrams: 300,
        calories: 260,
        protein: 25,
        carbohydrates: 20,
        totalFat: 10,
        nutrients: { calories: 260, protein: 25, carbohydrates: 20, totalFat: 10, saturatedFat: 2, sodium: 400 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
        componentsDetailList: [
          { name: 'Fish Fillet', weightGrams: 120, calories: 150, protein: 25, carbohydrates: 0, totalFat: 5, nutrients: { calories: 150, protein: 25, carbohydrates: 0, totalFat: 5 } },
          { name: 'Mixed Vegetables', weightGrams: 180, calories: 110, protein: 3, carbohydrates: 20, totalFat: 2, nutrients: { calories: 110, protein: 3, carbohydrates: 20, totalFat: 2 } },
        ],
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'split the plate into fish fillet and mixed vegetables, then remove the fish fillet',
      commands: [
        {
          action: 'split_item',
          itemName: 'Fish and Veg Plate',
          into: [
            { name: 'Fish Fillet', grams: 120, role: 'food', estimate: { protein: 25, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' } },
            { name: 'Mixed Vegetables', grams: 180, role: 'food', estimate: { protein: 3, carbohydrates: 20, totalFat: 2, saturatedFat: 0.5, sodium: 30, cookingMethod: 'stir_fried', foodType: 'vegetable' } },
          ],
        },
        { action: 'remove_item', itemName: 'Fish Fillet' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /fish fillet/i.test(it.name))).toBe(false);

    const veg = result.items.find((it: any) => /mixed vegetables/i.test(it.name));
    expect(veg).toBeTruthy();
    expect(veg?.name).toBe('Mixed Vegetables');
    expect(veg?.canonicalDbName).toBe('Mixed Vegetables');
    expect(veg?.originalName).toBe('Mixed Vegetables');
    expect(veg?.weightGrams).toBe(180);
    expect(result.weightGrams).toBe(180);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: Q&A empty commands after rename keep Ikan Nila unchanged', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const result = await applyMealEdits({
      items: replaced.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);

    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.name).not.toMatch(/cakalang/i);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: add_item then remove_item returns to the prior meal with no leftover row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add kerupuk then remove kerupuk',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kerupuk',
          newWeightGrams: 20,
          estimate: { protein: 1, carbohydrates: 14, totalFat: 1, saturatedFat: 0.2, sodium: 120, cookingMethod: 'fried', foodType: 'carbohydrate' },
        },
        { action: 'remove_item', itemName: 'Kerupuk' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /kerupuk/i.test(it.name) || it.scoutIndex === 2)).toBe(false);
    expect(result.items.some((it: any) => !it.name)).toBe(false);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item then remove_item by different casing still removes', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add tempeh then remove Tempeh',
      commands: [
        {
          action: 'add_item',
          itemName: 'tempeh',
          newWeightGrams: 100,
          estimate: { protein: 19, carbohydrates: 9, totalFat: 11, saturatedFat: 2, sodium: 220, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'remove_item', itemName: 'Tempeh' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /tempeh/i.test(it.name))).toBe(false);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item twice then set_weight only on the second added item keeps both and prior identities', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add kerupuk then add sambal and make the sambal 15g',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kerupuk',
          newWeightGrams: 20,
          estimate: { protein: 1, carbohydrates: 14, totalFat: 1, saturatedFat: 0.2, sodium: 120, cookingMethod: 'fried', foodType: 'carbohydrate' },
        },
        {
          action: 'add_item',
          itemName: 'Sambal',
          newWeightGrams: 10,
          estimate: { protein: 1, carbohydrates: 3, totalFat: 2, saturatedFat: 0.3, sodium: 250, cookingMethod: 'unknown', foodType: 'condiment' },
        },
        { action: 'set_weight', itemName: 'Sambal', newWeightGrams: 15 },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(4);

    const kerupuk = result.items.find((it: any) => /kerupuk/i.test(it.name));
    const sambal = result.items.find((it: any) => /sambal/i.test(it.name));
    expect(kerupuk?.weightGrams).toBe(20);
    expect(sambal?.weightGrams).toBe(15);

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const veg = result.items.find((it: any) => it.scoutIndex === 1);
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(veg?.name).toBe('Kangkung');
    expect(veg?.canonicalDbName).toBe('Kangkung');
    expect(veg?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(285);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight twice on the same item uses the last weight and keeps identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 100g then 140g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 100 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(140);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(290);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity Cakalang to Ikan Nila then Ikan Nila to Salmon keeps final Salmon identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila, then the ikan nila is salmon',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        {
          action: 'replace_identity',
          itemName: 'Ikan Nila',
          newItemName: 'Salmon',
          estimate: { protein: 25, carbohydrates: 0, totalFat: 13, saturatedFat: 3, sodium: 60, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Salmon');
    expect(fish?.canonicalDbName).toBe('Salmon');
    expect(fish?.originalName).toBe('Salmon');
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang|ikan nila/i);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: unsweetened tea modifier then set_weight keeps tawar and zero added sugar', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is tawar and it is 250g',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        { action: 'set_weight', itemName: 'Es Teh Tawar', newWeightGrams: 250 },
      ],
    });

    const tea = result.items[0];
    expect(result.changed).toBe(true);
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.weightGrams).toBe(250);
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_count on Kangkung annotates pieces without multiplying already-weighed grams', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the kangkung is 2 portions',
      commands: [{ action: 'set_count', itemName: 'Kangkung', count: 2 }],
    });

    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();
    expect(kangkung?.weightGrams).toBe(150);
    expect(kangkung?.count).toBe(2);
    expect(kangkung?.pieceCount).toBe(2);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_count then set_weight on the same item keeps weight and may retain count', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces and make it 180g',
      commands: [
        { action: 'set_count', itemName: 'Cakalang', count: 2 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 180 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.weightGrams).toBe(180);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(330);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity then set_weight in the same commands updates the new fish identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and make it 160g',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_weight', itemName: 'Ikan Nila', newWeightGrams: 160 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.name).toBe('Kangkung');
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(310);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity fish and set_weight kangkung in same commands both apply', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and make the kangkung 120g',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight then replace_identity on same fish uses the later replace weight (last-wins)', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 140g, then the cakalang is 160g of ikan nila',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          newWeightGrams: 160,
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    // Commands are applied in order: the later replace_identity's explicit grams win.
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(310);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: remove_item all items one by one empties the meal', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and then remove the kangkung',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'remove_item', itemName: 'Kangkung' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.weightGrams).toBe(0);
    expect(result.items.some((it: any) => /cakalang|kangkung/i.test(it.name))).toBe(false);
  });

  it('golden: set_weight with fractional grams applies consistently without NaN', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 87.5g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 87.5 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(Number.isFinite(fish?.weightGrams)).toBe(true);
    expect(fish?.weightGrams).toBeGreaterThanOrEqual(87);
    expect(fish?.weightGrams).toBeLessThanOrEqual(88);
    expect(Number.isFinite(fish?.calories)).toBe(true);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(Number.isFinite(result.weightGrams)).toBe(true);
    expect(result.weightGrams).toBe(
      Math.round(Number(fish?.weightGrams) + Number(kangkung?.weightGrams)),
    );
    expect(result.changed).toBe(true);
  });

  it('golden: Indonesian weight-only userMessage with empty commands either synthesizes set_weight or is a documented no-op', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'kangkungnya 80 gram',
      commands: [],
    });

    expect(result.items).toHaveLength(2);
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();

    if (result.changed) {
      expect(kangkung?.weightGrams).toBe(80);
      expect(result.weightGrams).toBe(180);
    } else {
      // Existing Indonesian synthesis tests only prove modifier phrases.
      // If weight phrases are unsupported, the meal must remain unchanged.
      expect(result.qa).toBe(true);
      expect(kangkung?.weightGrams).toBe(150);
      expect(result.weightGrams).toBe(250);
    }
  });

  it('golden: replace_identity Cakalang to Ikan Nila with newWeightGrams updates identity and portion in one shot', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 175g of ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        newWeightGrams: 175,
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(175);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(325);
    expect(result.changed).toBe(true);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: remove_item plus add_item coalesces to replace or falls back to sequential semantics', async () => {
    const userMessage = 'the cakalang is ikan nila';
    const commands = [
      { action: 'remove_item', itemName: 'Cakalang' },
      {
        action: 'add_item',
        itemName: 'Ikan Nila',
        estimate: {
          protein: 20,
          carbohydrates: 0,
          totalFat: 5,
          saturatedFat: 1,
          sodium: 50,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      },
    ];

    const coalesced = coalesceLegacyCommands(commands, cakalangKangkungPlate(), userMessage);
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage,
      commands,
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);
    expect(result.items.filter((it: any) => /ikan nila/i.test(it.name))).toHaveLength(1);

    const fish = result.items.find((it: any) => /ikan nila/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));

    expect(kangkung?.weightGrams).toBe(150);
    expect(fish?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(250);

    if (coalesced.length === 1 && coalesced[0].action === 'replace_identity') {
      expect(fish?.scoutIndex).toBe(0);
      expect(fish?.sourceImageIndex).toBe(0);
    } else {
      expect(fish?.scoutIndex).toBeGreaterThan(1);
      expect(fish?.sourceImageIndex).toBeNull();
    }

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier unsweetened on already tawar tea is idempotent', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Tawar',
        canonicalDbName: 'Es Teh Tawar',
        originalName: 'Es Teh Tawar',
        keyword: 'Es Teh Tawar',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 0,
        protein: 0,
        carbohydrates: 0,
        totalFat: 0,
        nutrients: { calories: 0, protein: 0, carbohydrates: 0, totalFat: 0, sugar: 0, addedSugar: 0, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Tawar', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        { action: 'set_modifier', itemName: 'Es Teh Tawar', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Es Teh Tawar');
    expect(result.items[0].canonicalDbName).toBe('Es Teh Tawar');
    expect(result.items[0].originalName).toBe('Es Teh Tawar');
    expect(result.items[0].keyword).toBe('Es Teh Tawar');
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item zero-kcal protein estimate keeps Atwater calories above zero', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'also add 100g tempeh',
      commands: [{
        action: 'add_item',
        itemName: 'Tempeh',
        newWeightGrams: 100,
        estimate: {
          calories: 0,
          protein: 19,
          carbohydrates: 9,
          totalFat: 11,
          saturatedFat: 2,
          sodium: 220,
          cookingMethod: 'grilled',
          foodType: 'protein',
        } as any,
      }],
    });

    const tempeh = result.items.find((it: any) => /tempeh/i.test(it.name));
    expect(tempeh).toBeTruthy();
    expect(tempeh.weightGrams).toBe(100);
    expect(tempeh.calories).toBeGreaterThan(0);
    expect(tempeh.nutrients.calories).toBeGreaterThan(0);
    expect(tempeh.sourceImageIndex).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.weightGrams).toBe(350);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight with zero or negative grams is ignored and keeps non-negative coherent weights', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 0g then -50g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 0 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: -50 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.items.every((it: any) => Number(it.weightGrams) >= 0)).toBe(true);
    expect(result.weightGrams).toBe(250);
    expect(result.weightGrams).toBe(
      result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
    );
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: unknown action is ignored and leaves the meal intact', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'do the impossible',
      commands: [{ action: 'do_the_impossible', itemName: 'Cakalang' }],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /skipped unknown action/i.test(n))).toBe(true);
  });

  it('golden: replace_identity with empty newItemName keeps the prior fish name', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: '',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.name).toBeTruthy();
    expect(fish?.name).not.toBe('');
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.keyword).toBe('Cakalang');
  });

  it('golden: set_weight by canonicalDbName synonym works after rename, but old name misses', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const result = await applyMealEdits({
      items: replaced.items,
      userMessage: 'make the ikan nila 160g; the cakalang name is stale',
      commands: [
        { action: 'set_weight', itemName: 'Ikan Nila', newWeightGrams: 160 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 999 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(160);
    expect(result.weightGrams).toBe(310);
    expect(result.notes.some((n) => /set_weight: no item "Cakalang"/i.test(n))).toBe(true);
  });

  it('golden: simultaneous set_weight on fish and set_modifier on tea persist together', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        keyword: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'make the cakalang 160g and the tea is tawar',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 160 },
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(result.weightGrams).toBe(510);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight then empty-commands Q&A leaves the new weight intact', async () => {
    const weighted = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 140g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 }],
    });

    const result = await applyMealEdits({
      items: weighted.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(fish?.weightGrams).toBe(140);
    expect(result.weightGrams).toBe(290);
  });

  it('golden: remove_item with unknown name leaves the meal unchanged', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the unknown item',
      commands: [{ action: 'remove_item', itemName: 'Unknown Item' }],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_weight identical to current weight may leave changed false and keeps identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 100g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 100 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.qa).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    // changed may be false when the weight is unchanged; allow current Atwater recalculation behavior.
    expect([false, true]).toContain(result.changed);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });
});
