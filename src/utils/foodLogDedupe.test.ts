import { describe, it, expect } from 'vitest';
import {
  foodLogFingerprint,
  mergeFoodLogsDeduped,
  rehydrateFoodImagesFromDonors,
} from './foodLogDedupe';

const yolk = (overrides: any = {}) => ({
  id: overrides.id || 'a',
  name: 'YOLK Breakfast Bowl',
  date: '2026-08-08',
  weightGrams: 350,
  updated_at: overrides.updated_at ?? 1,
  imageUrl: overrides.imageUrl,
  imageUrls: overrides.imageUrls,
  nutrients: { calories: 450 },
  ...overrides,
});

describe('foodLogFingerprint', () => {
  it('is stable across whitespace/case differences in name', () => {
    const a = foodLogFingerprint(yolk({ name: 'YOLK Breakfast Bowl' }));
    const b = foodLogFingerprint(yolk({ name: '  yolk breakfast bowl  ' }));
    expect(a).toBe(b);
  });

  it('normalizes DD-MM-YYYY and YYYY-MM-DD to same day', () => {
    const a = foodLogFingerprint(yolk({ date: '2026-08-06' }));
    const b = foodLogFingerprint(yolk({ date: '06-08-2026' }));
    expect(a).toBe(b);
  });

  it('collapses ISO datetime to calendar day', () => {
    const a = foodLogFingerprint(yolk({ date: '2026-08-06' }));
    const b = foodLogFingerprint(yolk({ date: '2026-08-06T18:30:00.000Z' }));
    expect(a).toBe(b);
  });
});

describe('mergeFoodLogsDeduped', () => {
  it('collapses two rows with same day/name/kcal but different ids into one', () => {
    const local = [yolk({ id: 'local-1', updated_at: 1 })];
    const cloud = [yolk({ id: 'cloud-2', updated_at: 2 })];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(1);
  });

  it('keeps both when calories differ (different meal)', () => {
    const local = [yolk({ id: 'local-1' })];
    const cloud = [yolk({ id: 'cloud-2', nutrients: { calories: 900 } })];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(2);
  });

  it('prefers the side with a real image when collapsing duplicates', () => {
    const local = [yolk({ id: 'local-1', updated_at: 5, imageUrl: undefined })];
    const cloud = [
      yolk({ id: 'cloud-2', updated_at: 1, imageUrl: 'https://cdn.example.com/real.jpg' }),
    ];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/real.jpg');
  });

  it('collapses oatmeal-style duplicates and keeps image', () => {
    const a = {
      id: 'id1',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '2026-08-06',
      nutrients: { calories: 405 },
      imageUrl: 'https://cdn.example.com/oats.jpg',
      updated_at: 1,
    };
    const b = {
      id: 'id2',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '06-08-2026',
      nutrients: { calories: 405 },
      imageUrl: '[image_removed_for_snapshot]',
      updated_at: 2,
    };
    const result = mergeFoodLogsDeduped([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/oats.jpg');
  });
});

describe('rehydrateFoodImagesFromDonors', () => {
  it('copies image by fingerprint when ids differ', () => {
    const targets = [
      yolk({ id: 'cloud-new', imageUrl: '[image_removed_for_snapshot]', imageUrls: [] }),
    ];
    const donors = [
      yolk({
        id: 'local-old',
        imageUrl: 'https://cdn.example.com/meal.jpg',
      }),
    ];
    const out = rehydrateFoodImagesFromDonors(targets, donors);
    expect(out[0].imageUrl).toBe('https://cdn.example.com/meal.jpg');
  });
});

describe('soft name merge (YOLK variants)', () => {
  it('collapses Chimi Salad Bowl vs Steak Bowl same day same kcal', () => {
    const a: any = {
      id: 'a1',
      name: 'Yolk Chicken Sandwich and Steak Salad Bowl',
      date: '2026-08-07',
      nutrients: { calories: 1410 },
      updated_at: 1,
    };
    const b: any = {
      id: 'b1',
      name: 'Yolk Chicken Sandwich and Steak Bowl',
      date: '07-08-2026',
      nutrients: { calories: 1410 },
      imageUrl: 'https://cdn.example.com/yolk.jpg',
      updated_at: 2,
    };
    const result = mergeFoodLogsDeduped([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/yolk.jpg');
  });

  it('collapses identical oatmeal / honi with date format drift', () => {
    const o1: any = {
      id: 'o1',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '2026-08-06',
      nutrients: { calories: 405 },
    };
    const o2: any = {
      id: 'o2',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '06-08-2026',
      nutrients: { calories: 405 },
      imageUrl: 'https://cdn.example.com/oats.jpg',
    };
    expect(mergeFoodLogsDeduped([o1, o2], [])).toHaveLength(1);

    const h1 = {
      id: 'h1',
      name: 'Honi Poke Salmon Poke Bowl with Sides',
      date: '2026-08-04',
      nutrients: { calories: 1176 },
    };
    const h2 = {
      id: 'h2',
      name: 'Honi Poke Salmon Poke Bowl with Sides',
      date: '04-08-2026',
      nutrients: { calories: 1176 },
    };
    expect(mergeFoodLogsDeduped([h1, h2], [])).toHaveLength(1);
  });
});
