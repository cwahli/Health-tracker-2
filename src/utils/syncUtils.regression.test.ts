/**
 * Multi-device sync regression fixtures: mergeByRecency, tombstones, mergeProfiles, mergeBiomarkerHistory.
 * Domain: docs/agent/domains/sync.md
 */
import { describe, it, expect } from 'vitest';
import {
  mergeByRecency,
  mergeDeleteMaps,
  isLogTombstoned,
  filterLogsByTombstone,
  mergeProfiles,
  mergeBiomarkerHistory,
  foodLogToSupabaseRow,
  supabaseRowToFoodLog,
} from './syncUtils';
import type { UserProfile, BiomarkerLog, FoodLog } from '../types';

describe('mergeByRecency', () => {
  it('keeps local-only items (absence from server is not delete)', () => {
    const local = [{ id: 'L', updated_at: 10, name: 'local' }];
    const server: typeof local = [];
    const out = mergeByRecency(local, server);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('L');
  });

  it('adds server-only items', () => {
    const out = mergeByRecency([], [{ id: 'S', updated_at: 5 }]);
    expect(out.map((x) => x.id)).toEqual(['S']);
  });

  it('server wins only when strictly newer', () => {
    const local = [{ id: 'A', updated_at: 10, v: 'L' }];
    const server = [{ id: 'A', updated_at: 20, v: 'S' }];
    expect(mergeByRecency(local, server)[0].v).toBe('S');
  });

  it('local wins when server is older or equal', () => {
    const local = [{ id: 'A', updated_at: 20, v: 'L' }];
    expect(mergeByRecency(local, [{ id: 'A', updated_at: 10, v: 'S' }])[0].v).toBe('L');
    expect(mergeByRecency(local, [{ id: 'A', updated_at: 20, v: 'S' }])[0].v).toBe('L');
  });

  it('unions different ids', () => {
    const out = mergeByRecency(
      [{ id: 'A', updated_at: 1 }],
      [{ id: 'B', updated_at: 1 }]
    );
    expect(out.map((x) => x.id).sort()).toEqual(['A', 'B']);
  });

  it('missing updated_at treated as 0 → local wins on equal', () => {
    const out = mergeByRecency([{ id: 'A', v: 'L' } as any], [{ id: 'A', v: 'S' } as any]);
    expect(out[0].v).toBe('L');
  });
});

describe('mergeDeleteMaps + isLogTombstoned + filterLogsByTombstone', () => {
  it('max-merges delete maps', () => {
    expect(mergeDeleteMaps({ a: 5 }, { a: 9, b: 7 })).toEqual({ a: 9, b: 7 });
    expect(mergeDeleteMaps(undefined as any, { a: 1 })).toEqual({ a: 1 });
  });

  it('tombstone 0 is not active', () => {
    expect(isLogTombstoned('x', 5, { x: 0 }, 'presence')).toBe(false);
    expect(isLogTombstoned('x', 5, { x: 0 }, 'recency')).toBe(false);
  });

  it('presence mode drops any positive tombstone regardless of updated_at', () => {
    expect(isLogTombstoned('f1', 999, { f1: 10 }, 'presence')).toBe(true);
  });

  it('recency mode: tombstone >= updated_at drops; newer item revives', () => {
    expect(isLogTombstoned('b1', 5, { b1: 10 }, 'recency')).toBe(true);
    expect(isLogTombstoned('b1', 10, { b1: 10 }, 'recency')).toBe(true);
    expect(isLogTombstoned('b1', 20, { b1: 10 }, 'recency')).toBe(false);
  });

  it('filterLogsByTombstone drops sync_state delete and tombstoned ids', () => {
    const items = [
      { id: 'keep', updated_at: 50 },
      { id: 'gone', updated_at: 5 },
      { id: 'soft', updated_at: 50, sync_state: 'delete' as const },
      { id: 'revived', updated_at: 100 },
    ];
    const map = { gone: 10, revived: 10 };
    const recency = filterLogsByTombstone(items, map, 'recency');
    expect(recency.map((i) => i.id).sort()).toEqual(['keep', 'revived']);
    const presence = filterLogsByTombstone(items, map, 'presence');
    expect(presence.map((i) => i.id)).toEqual(['keep']);
  });
});

describe('mergeProfiles tombstones', () => {
  const base = (over: Partial<UserProfile> = {}): UserProfile =>
    ({ lastUpdatedAt: 100, ...over } as UserProfile);

  it('unions food/bio delete maps with max timestamps', () => {
    const cloud = base({
      lastUpdatedAt: 50,
      deletedFoodLogIds: { A: 5 },
      deletedBiomarkerLogIds: { B: 8 },
    });
    const local = base({
      lastUpdatedAt: 100,
      deletedFoodLogIds: { A: 9, C: 1 },
      deletedBiomarkerLogIds: { B: 3 },
    });
    const m = mergeProfiles(cloud, local)!;
    expect(m.deletedFoodLogIds).toEqual({ A: 9, C: 1 });
    expect(m.deletedBiomarkerLogIds).toEqual({ B: 8 });
  });

  it('custom biomarker with tombstone stays deleted', () => {
    const cloud = base({
      lastUpdatedAt: 200,
      customBiomarkers: { foo: { name: 'Foo', unit: 'x' } } as any,
      deletedCustomBiomarkerKeys: { foo: 50 },
    });
    const local = base({
      lastUpdatedAt: 100,
      customBiomarkers: { foo: { name: 'Foo local', unit: 'x' } } as any,
    });
    const m = mergeProfiles(cloud, local)!;
    expect(m.customBiomarkers?.foo).toBeUndefined();
    expect(m.deletedCustomBiomarkerKeys?.foo).toBe(50);
  });

  it('notUsed: tombstone wins when >= flaggedAt; re-flag after tombstone keeps flag', () => {
    const cloud = base({
      notUsedBiomarkers: { k: { flaggedAt: 100 } },
      deletedNotUsedBiomarkerKeys: { k: 200 },
    });
    const local = base({ lastUpdatedAt: 50 });
    const m1 = mergeProfiles(cloud, local)!;
    expect(m1.notUsedBiomarkers?.k).toBeUndefined();

    const reflag = base({
      lastUpdatedAt: 300,
      notUsedBiomarkers: { k: { flaggedAt: 300 } },
      deletedNotUsedBiomarkerKeys: { k: 200 },
    });
    const m2 = mergeProfiles(cloud, reflag)!;
    expect(m2.notUsedBiomarkers?.k?.flaggedAt).toBe(300);
  });
});

describe('mergeBiomarkerHistory', () => {
  const log = (
    id: string,
    updated_at: number,
    biomarkers: Record<string, any>,
    extra: Partial<BiomarkerLog> = {}
  ): BiomarkerLog =>
    ({ id, date: '2026-01-01', biomarkers, updated_at, ...extra } as BiomarkerLog);

  it('newer local biomarkers object is authoritative (no reappear of deleted keys from cloud)', () => {
    const local = [log('1', 20, { A: 1, B: 2 })];
    const cloud = [log('1', 10, { A: 9, C: 3 })];
    const out = mergeBiomarkerHistory(cloud, local, {});
    expect(out).toHaveLength(1);
    expect(out[0].biomarkers).toEqual({ A: 1, B: 2 });
    expect(out[0].biomarkers.C).toBeUndefined();
  });

  it('newer cloud biomarkers object is authoritative (local-only key does not stick)', () => {
    const local = [log('1', 5, { A: 1, B: 2 })];
    const cloud = [log('1', 10, { A: 9, C: 3 })];
    const out = mergeBiomarkerHistory(cloud, local, {});
    expect(out[0].biomarkers).toEqual({ A: 9, C: 3 });
    expect(out[0].biomarkers.B).toBeUndefined();
  });

  it('equal timestamps union biomarkers', () => {
    const local = [log('1', 10, { A: 1, B: 2 })];
    const cloud = [log('1', 10, { A: 9, C: 3 })];
    const out = mergeBiomarkerHistory(cloud, local, {});
    expect(out[0].biomarkers).toEqual({ A: 1, B: 2, C: 3 });
  });

  it('tombstone removes id; sync_state delete on cloud removes id', () => {
    const local = [log('1', 5, { A: 1 })];
    expect(mergeBiomarkerHistory([log('1', 5, { A: 1 })], local, { '1': 10 })).toHaveLength(0);
    expect(
      mergeBiomarkerHistory([log('1', 50, { A: 1 }, { sync_state: 'delete' })], local, {})
    ).toHaveLength(0);
  });

  it('device A offline create retained when server empty (via local-only in history merge)', () => {
    const local = [log('new', 1, { hba1c: 40 })];
    const out = mergeBiomarkerHistory([], local, {});
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('new');
  });
});

describe('food log supabase mapper round-trip identity', () => {
  it('preserves id and updated_at through row mapping', () => {
    const food = {
      id: 'meal-1',
      date: '08-08-2026',
      name: 'Test Meal',
      weightGrams: 200,
      nutrients: { calories: 400, saturatedFat: 1, sodium: 2, addedSugar: 3 },
      updated_at: 1_700_000_000_000,
      imageUrls: ['https://example.com/a.jpg'],
    } as FoodLog;
    const row = foodLogToSupabaseRow(food, 'uid1');
    expect(row.id).toBe('meal-1');
    expect(row.firebase_uid).toBe('uid1');
    const back = supabaseRowToFoodLog(row);
    expect(back.id).toBe('meal-1');
    expect(back.updated_at).toBe(1_700_000_000_000);
    expect(back.nutrients?.calories).toBe(400);
  });
});

/** Multi-device narrative fixtures (pure layer) */
describe('multi-device scenarios (pure)', () => {
  it('F1: delete on A (tombstone) → B merge keeps item gone', () => {
    const afterDeleteLocal: { id: string; updated_at: number; name?: string; sync_state?: string }[] = [];
    const staleOnB: { id: string; updated_at: number; name?: string; sync_state?: string }[] = [{ id: 'meal-x', updated_at: 5, name: 'Ghost' }];
    const deleted = { 'meal-x': 100 };
    // B pulls: merge recency then filter tombstone
    const merged = mergeByRecency(staleOnB, afterDeleteLocal);
    const visible = filterLogsByTombstone(merged, deleted, 'recency');
    expect(visible).toHaveLength(0);
  });

  it('F2: A update newer than B cache → A wins', () => {
    const deviceB = [{ id: '1', updated_at: 10, name: 'old' }];
    const fromA = [{ id: '1', updated_at: 50, name: 'new' }];
    expect(mergeByRecency(deviceB, fromA)[0].name).toBe('new');
  });

  it('F3: offline local create + empty server → local retained', () => {
    const local = [{ id: 'offline-1', updated_at: 1 }];
    expect(mergeByRecency(local, [])).toHaveLength(1);
  });
});
