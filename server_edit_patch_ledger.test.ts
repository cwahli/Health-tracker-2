import { describe, it, expect } from 'vitest';
import {
  diffScoutToEditCommands,
  applyUserLockedSlots,
  mergeLocksFromCommands,
  invalidateStaleIdentityMetadata,
  buildEditExpertDispatch,
  reaggregateDishWeightFromComponents,
} from './server_edit_patch_ledger.js';

describe('edit patch ledger', () => {
  it('diffs identity + weight into structural commands', () => {
    const prior = [
      { scoutIndex: 0, name: 'Cakalang Suwir Petai', weightGrams: 200, nutrients: { protein: 40 } },
      { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 210, nutrients: { protein: 5 } },
      { scoutIndex: 2, name: 'Es Teh Manis', weightGrams: 350, nutrients: { calories: 56, sugar: 14 } },
    ];
    const scout = [
      { scoutIndex: 0, originalName: 'Nila Suwir Petai', estimatedWeightGrams: 200, nutrients: { protein: 38 } },
      { scoutIndex: 1, originalName: 'Tumis Kangkung', estimatedWeightGrams: 125 },
      { scoutIndex: 2, originalName: 'Es Teh Tawar', estimatedWeightGrams: 350, nutrients: { calories: 0, sugar: 0 } },
    ];
    const cmds = diffScoutToEditCommands({ priorItems: prior, scoutItems: scout });
    expect(cmds.some((c) => c.action === 'replace_identity' && c.newItemName === 'Nila Suwir Petai')).toBe(true);
    expect(cmds.some((c) => c.action === 'set_weight' && c.itemName === 'Tumis Kangkung' && c.newWeightGrams === 125)).toBe(true);
    expect(cmds.some((c) => c.action === 'replace_identity' && String(c.newItemName).includes('Tawar'))).toBe(true);
  });

  it('enforces identity locks against scout regression', () => {
    const locked = applyUserLockedSlots({
      scoutItems: [
        { scoutIndex: 0, originalName: 'Cakalang Suwir Petai', estimatedWeightGrams: 200 },
        { scoutIndex: 1, originalName: 'Tumis Kangkung', estimatedWeightGrams: 125 },
      ],
      locks: [{ scoutIndex: 0, field: 'identity', value: 'Nila Suwir Petai', lockedAtTurn: 2 }],
      userMessage: 'the kangkung is 100g',
    });
    expect(locked.items[0].originalName).toBe('Nila Suwir Petai');
    expect(locked.notes.some((n) => n.includes('lock identity'))).toBe(true);
  });

  it('invalidates stale manis sibling metadata on identity change', () => {
    const purged = invalidateStaleIdentityMetadata({
      name: 'Es Teh Manis',
      keyword: 'Es Teh Tawar',
      ingredientsList: ['Es Teh Manis'],
      visualIngredients: ['Es Teh Manis'],
      genericEnglishName: 'sweetened iced tea',
      preCalcNutrients: { calories: 56, sugar: 14 },
      nutrients: { calories: 0 },
    }, 'Es Teh Tawar');
    expect(purged.name).toBe('Es Teh Tawar');
    expect(purged.ingredientsList).toEqual(['Es Teh Tawar']);
    expect(purged.visualIngredients).toEqual(['Es Teh Tawar']);
    expect(purged.preCalcNutrients).toBeUndefined();
    expect(purged.genericEnglishName).toBeUndefined();
  });

  it('merges locks from applied commands', () => {
    const locks = mergeLocksFromCommands({
      priorLocks: [],
      commands: [
        { action: 'replace_identity', itemName: 'Cakalang Suwir Petai', newItemName: 'Nila Suwir Petai', scoutIndex: 0 },
        { action: 'set_weight', itemName: 'Tumis Kangkung', newWeightGrams: 125, scoutIndex: 1 },
      ],
      itemsAfter: [
        { scoutIndex: 0, name: 'Nila Suwir Petai', weightGrams: 200 },
        { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 125 },
      ],
      turn: 2,
      userMessage: 'the tea is tawar and the fish is nilai',
    });
    expect(locks.find((l) => l.field === 'identity' && l.scoutIndex === 0)?.value).toBe('Nila Suwir Petai');
    expect(locks.find((l) => l.field === 'weightGrams' && l.scoutIndex === 1)?.value).toBe(125);
  });

  it('builds expert dispatch with full I/O fields', () => {
    const d = buildEditExpertDispatch({
      turn: 2,
      userMessage: 'the tea is tawar',
      finalMessage: 'Updated tea to unsweetened.',
      editCommands: [{ action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened' }],
      items: [{ scoutIndex: 2, name: 'Es Teh Tawar', weightGrams: 350, nutrients: { calories: 0 } }],
    });
    expect(d.id).toBe('t2/dietitian');
    expect(d.agent).toBe('dietitian');
    expect(d.systemInstruction).toBeTruthy();
    expect(d.systemInstruction).toContain('TARGETED DISH UPDATE ONLY');
    expect(d.userPrompt).toBeTruthy();
    expect(d.rawEmission).toBeTruthy();
    expect(d.output.skipped).toBe(false);
  });

  it('carries verdict alongside the advice message for contract parity', () => {
    const d = buildEditExpertDispatch({
      turn: 2,
      userMessage: 'oats 130g',
      finalMessage: 'You got quality protein from the meat soups and steady energy from the adjusted cereal portion in this meal.',
      editCommands: [{ action: 'update_weight', itemName: 'Energen Cereal', newWeightGrams: 130 }],
      items: [{ scoutIndex: 2, name: 'Energen Cereal', weightGrams: 130, nutrients: { calories: 557 } }],
      verdict: { label: 'Increased Carbohydrate and Calorie Load', level: 'warning' },
    });
    expect(d.output.verdict).toEqual({ label: 'Increased Carbohydrate and Calorie Load', level: 'warning' });
    expect(d.rawEmission.verdict.label).toBeTruthy();
    const bare = buildEditExpertDispatch({
      turn: 2,
      finalMessage: 'Updated.',
      editCommands: [],
      items: [],
    });
    expect(bare.output.verdict).toBeUndefined();
  });

  it('preserves prior identity locks when a later turn only sets weight', () => {
    const locks = mergeLocksFromCommands({
      priorLocks: [
        { scoutIndex: 0, field: 'identity', value: 'Ikan Nila Suwir Petai', lockedAtTurn: 2 },
        { scoutIndex: 2, field: 'identity', value: 'Es Teh Tawar', lockedAtTurn: 2 },
      ],
      commands: [
        { action: 'set_weight', itemName: 'Tumis Kangkung', newWeightGrams: 120, scoutIndex: 1 },
      ],
      itemsAfter: [
        { scoutIndex: 0, name: 'Ikan Nila Suwir Petai', weightGrams: 160 },
        { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 120 },
        { scoutIndex: 2, name: 'Es Teh Tawar', weightGrams: 300 },
      ],
      turn: 3,
      userMessage: 'the kangkung is 100g',
    });
    expect(locks.find((l) => l.field === 'identity' && l.scoutIndex === 0)?.value).toBe('Ikan Nila Suwir Petai');
    expect(locks.find((l) => l.field === 'weightGrams' && l.scoutIndex === 1)?.value).toBe(120);
  });

  it('reaggregates parent weight from components', () => {
    const out = reaggregateDishWeightFromComponents({
      name: 'Tumis Kangkung',
      weightGrams: 210,
      nutrients: { calories: 123, protein: 5 },
      componentsDetailList: [
        { name: 'Kangkung', weightGrams: 100, nutrients: { calories: 20 } },
        { name: 'Oil', weightGrams: 25, nutrients: { calories: 50 } },
      ],
    });
    expect(out.weightGrams).toBe(125);
  });

  it('diffs portion update with empty scout emission via arrow syntax in userMessage', () => {
    const prior = [
      { scoutIndex: 0, name: 'Lemonilo Brownies Crispy', weightGrams: 15, nutrients: { calories: 70 } },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: [],
      userMessage: 'Please update my meal portions: Lemonilo Brownies Crispy: 15g ➔ 30g (+100%). Because the portion difference exceeds 30%, please review...',
    });
    expect(cmds.length).toBe(1);
    expect(cmds[0].action).toBe('set_weight');
    expect(cmds[0].itemName).toBe('Lemonilo Brownies Crispy');
    expect(cmds[0].newWeightGrams).toBe(30);
  });

  it('diffs portion update with empty scout emission via portionChoices', () => {
    const prior = [
      { scoutIndex: 0, name: 'Lemonilo Brownies Crispy', weightGrams: 15, nutrients: { calories: 70 } },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: [],
      portionChoices: { '0': 30 },
    });
    expect(cmds.length).toBe(1);
    expect(cmds[0].action).toBe('set_weight');
    expect(cmds[0].itemName).toBe('Lemonilo Brownies Crispy');
    expect(cmds[0].newWeightGrams).toBe(30);
  });

  it('aligns scout partial dish update to correct item in multi-dish meal without deleting others', () => {
    const prior = [
      { scoutIndex: 0, name: 'Beef and Vegetable Hotpot', weightGrams: 300, sourceImageIndex: 0 },
      { scoutIndex: 1, name: 'Sizzling Steak and Sausages', weightGrams: 200, sourceImageIndex: 1 },
    ];
    const scout = [
      {
        name: 'Sizzling Steak and Sausages with Vegetables',
        estimatedWeightGrams: 180,
        sourceImageIndex: 1,
        foods: [
          { foodName: 'Beef Steak', weightGrams: 100 },
          { foodName: 'Mixed Vegetables', weightGrams: 80 },
        ],
      },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: scout,
      userMessage: 'The beef steak is 100g and there was vegetable as well in this plate',
    });
    // Beef Hotpot must NOT be replaced!
    expect(cmds.some(c => c.itemName === 'Beef and Vegetable Hotpot' && c.action === 'replace_identity')).toBe(false);
    // Steak item must be targeted
    expect(cmds.some(c => c.itemName === 'Sizzling Steak and Sausages')).toBe(true);
  });
});
