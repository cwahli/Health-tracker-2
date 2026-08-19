import { describe, it, expect } from 'vitest';
import {
  buildFoodDomainPack,
  buildBiomarkerDomainPack,
  resolveDomainPack,
  domainPackForAgent,
  buildOverviewMarkdown,
  foodSummaryLine,
  capTombstoneMap,
} from './bugDomainPacks';

describe('bugDomainPacks', () => {
  it('buildFoodDomainPack extracts mode macros receipt', () => {
    const pack = buildFoodDomainPack({
      job: {
        id: 'job_1',
        status: 'succeeded',
        mode: 'review',
        result: {
          mode: 'review',
          pendingFoodLog: {
            name: 'Yogurt bowl',
            weightGrams: 300,
            nutrients: { calories: 420, protein: 18, carbohydrates: 40 },
            itemsBreakdown: [{ originalName: 'yogurt', weightGrams: 200, calories: 150 }],
            receiptTable: [{ item: 'yogurt', source: 'LABEL', notes: 'locked' }],
          },
          scoutItems: [{ originalName: 'honey', estimatedWeightGrams: 15 }],
        },
      },
    });
    expect(pack.mealName).toBe('Yogurt bowl');
    expect(pack.nutrients?.calories).toBe(420);
    expect(pack.items?.[0].name).toBe('yogurt');
    expect(pack.receipt?.[0].source).toBe('LABEL');
    expect(pack.mode).toBe('review');
    expect(foodSummaryLine(pack)).toContain('420');
  });

  it('buildBiomarkerDomainPack extracts keys and values', () => {
    const pack = buildBiomarkerDomainPack({
      job: {
        id: 'med_1',
        kind: 'medical',
        status: 'succeeded',
        result: {
          agentLabel: 'Biomarker Review',
          biomarkers: [
            { key: 'cholesterol', value: 5.2, unit: 'mmol/L' },
            { key: 'hba1c', value: 5.4, unit: '%' },
          ],
          message: 'Review complete',
        },
      },
      profile: { unitPreference: 'SI' },
    });
    expect(pack.keys).toContain('cholesterol');
    expect(pack.valuesSample?.[0].unit).toBe('mmol/L');
    expect(pack.agentLabel).toContain('Biomarker');
    expect(pack.unitPreference).toBe('SI');
  });

  it('resolveDomainPack picks food vs biomarker by category/tab', () => {
    const food = resolveDomainPack({
      category: 'foodcart',
      activeTab: 'food',
      jobs: [
        {
          id: 'j1',
          kind: 'food_log',
          status: 'succeeded',
          result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 1 } } },
        },
      ],
    });
    expect(food.domain).toBe('food');
    expect(food.food?.mealName).toBe('Meal');

    const bio = resolveDomainPack({
      category: 'biomarker',
      activeTab: 'medical',
      jobs: [
        {
          id: 'm1',
          kind: 'medical',
          status: 'succeeded',
          result: { biomarkers: { glucose: { value: 5, unit: 'mmol/L' } } },
        },
      ],
    });
    expect(bio.domain).toBe('biomarker');
    expect(bio.biomarker?.keys?.length).toBeGreaterThan(0);
  });

  it('does not attach an older food job just because it is last in the array', () => {
    const croissant = {
      id: 'job_1786666026077_que4vcxxi',
      kind: 'food_log',
      status: 'succeeded',
      updatedAt: '2026-08-14T00:33:00.000Z',
      result: { pendingFoodLog: { name: 'Chocolate Croissants, Vegetarian Wrap, and Quinoa Salad', nutrients: { calories: 1711 } } },
    };
    const prawn = {
      id: 'job_1786659764445_qulpm799r',
      kind: 'food_log',
      status: 'succeeded',
      updatedAt: '2026-08-13T22:42:00.000Z',
      result: { pendingFoodLog: { name: 'Prawn Layered Pasta Salad with Ham and Doughnut', nutrients: { calories: 903 } } },
    };
    // Array-end is the stale meal — the old walker picked this.
    const pack = resolveDomainPack({
      category: 'foodcart',
      jobs: [croissant, prawn],
      payload: {},
    });
    expect(pack.food?.jobId).toBe(croissant.id);
    expect(pack.food?.mealName).toMatch(/Croissant/i);

    const viewed = resolveDomainPack({
      category: 'foodcart',
      jobs: [croissant, prawn],
      jobId: prawn.id,
      payload: {},
    });
    expect(viewed.food?.jobId).toBe(prawn.id);
  });

  it('Home snap includes BMI log ids and tombstones, not a generic empty pack', () => {
    const pack = resolveDomainPack({
      category: 'Home',
      activeTab: 'home',
      jobs: [],
      payload: { activeTab: 'home', jobsCount: 0 },
      biomarkers: { bmi: 23 },
      biomarkerHistory: [
        {
          id: 'log_bmi_2020',
          date: '04-11-2020',
          sync_state: 'synced',
          updated_at: 1,
          biomarkers: { bmi: 2 },
        },
      ],
      profile: {
        deletedBiomarkerLogIds: { log_bmi_2020: 1700000000000 },
        deletedCustomBiomarkerKeys: {},
      },
    });
    expect(pack.domain).toBe('biomarker');
    expect(pack.biomarker?.keys).toContain('bmi');
    expect(pack.biomarker?.historySample?.[0].id).toBe('log_bmi_2020');
    expect(pack.biomarker?.historySample?.[0].values?.bmi).toBe(2);
    expect(pack.biomarker?.tombstones?.deletedBiomarkerLogIds?.log_bmi_2020).toBe(1700000000000);
    expect(pack.summaryLine).toMatch(/bmi/i);
  });

  it('keeps real tombstone ids and puts bmi on a crowded 2020 log', () => {
    expect(capTombstoneMap({ log_real: 9, '0': 0, '1': 0 })).toEqual({ log_real: 9 });
    expect(capTombstoneMap(['log_a', 'log_b'])).toMatchObject({ log_a: expect.any(Number), log_b: expect.any(Number) });
    expect(capTombstoneMap([null, 0, undefined])).toBeUndefined();

    const crowded: Record<string, number> = { height: 164, weight: 61.9 };
    for (let i = 0; i < 20; i++) crowded[`audit_${i}`] = i;
    crowded.bmi = 2;
    const pack = buildBiomarkerDomainPack({
      biomarkerHistory: [{ id: 'med_2020', date: '04-11-2020', biomarkers: crowded, sync_state: 'synced' }],
      profile: { deletedBiomarkerLogIds: ['med_2020'] },
    });
    expect(pack.historySample?.[0].values?.bmi).toBe(2);
    expect(pack.tombstones?.deletedBiomarkerLogIds?.med_2020).toBeTruthy();
    expect(pack.kind).toBe('home');
  });

  it('does not glue a leftover food job onto a Home / biomarker snap', () => {
    const leftover = {
      id: 'job_food_stale',
      kind: 'food_log',
      status: 'succeeded',
      updatedAt: '2026-08-19T23:40:00.000Z',
      result: { pendingFoodLog: { name: 'Prawn pasta salad', nutrients: { calories: 900 } } },
    };
    const pack = resolveDomainPack({
      category: 'Home',
      activeTab: 'home',
      jobs: [leftover],
      payload: { jobId: leftover.id, kind: 'food_log', pendingFoodLog: leftover.result.pendingFoodLog },
      biomarkerHistory: [
        { id: 'log_bmi_2020', date: '04-11-2020', biomarkers: { bmi: 2 }, sync_state: 'synced' },
      ],
      biomarkers: { bmi: 23 },
      profile: {},
    });
    expect(pack.domain).toBe('biomarker');
    expect(pack.food).toBeUndefined();
    expect(pack.biomarker?.jobId).toBeFalsy();
    expect(pack.summaryLine).not.toMatch(/Prawn/i);
    expect(pack.biomarker?.keys).toContain('bmi');
  });

  it('domainPackForAgent and overview mark a11y primary', () => {
    const pack = resolveDomainPack({
      category: 'foodcart',
      payload: { pendingFoodLog: { name: 'X', nutrients: { calories: 10 } } },
    });
    const json = domainPackForAgent(pack);
    expect(json).toContain('food');
    const md = buildOverviewMarkdown({
      category: 'foodcart',
      domainPack: pack,
      a11yOutline: '- [dialog] "Food"',
      shotCount: 1,
      hasLogs: true,
    });
    expect(md).toContain('A11y');
    expect(md).toContain('all agents');
    expect(md).toContain('Domain pack');
  });
});
