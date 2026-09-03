import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import {
  getStorageKey,
  getSnapshotKey,
  MAX_SNAPSHOTS,
  sanitizeForIdb,
  get,
  set,
  saveLocalSnapshot,
  loadLocalSnapshots,
  deleteLocalSnapshot,
  safeSaveToLocalStorage,
  clearCachedAppData,
  clearChatMemoryKeys
} from './storageUtils';

describe('Storage and Snapshot Utils', () => {
  const store = new Map<string, string>();

  beforeAll(() => {
    const localStorageMock = {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] || null,
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true
    });
  });

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  describe('getStorageKey', () => {
    it('returns standard key for a given email', () => {
      const key = getStorageKey('User.Test@gmail.com');
      expect(key).toBe('health_cockpit_app_data_user.test@gmail.com');
    });

    it('trims whitespace and converts to lowercase', () => {
      const key = getStorageKey('   TEST@domain.com   ');
      expect(key).toBe('health_cockpit_app_data_test@domain.com');
    });

    it('falls back to fallbackEmail if email is falsy', () => {
      const key = getStorageKey(null, 'fallback@domain.com');
      expect(key).toBe('health_cockpit_app_data_fallback@domain.com');
    });

    it('falls back to guest if both are falsy', () => {
      const key = getStorageKey(null, null);
      expect(key).toBe('health_cockpit_app_data_guest');
    });

    it('normalizes admin/chiwah variations to cwah.liu@gmail.com', () => {
      expect(getStorageKey('admin_chiwah_liu')).toBe('health_cockpit_app_data_cwah.liu@gmail.com');
      expect(getStorageKey('cwah.liu@gmail.com')).toBe('health_cockpit_app_data_cwah.liu@gmail.com');
    });
  });

  describe('getSnapshotKey', () => {
    it('returns correct snapshot key structure', () => {
      const key = getSnapshotKey('User.Test@gmail.com');
      expect(key).toBe('health_cockpit_snapshots_user.test@gmail.com');
    });

    it('falls back to guest if email is missing', () => {
      const key = getSnapshotKey(null, null);
      expect(key).toBe('health_cockpit_snapshots_guest');
    });
  });

  describe('MAX_SNAPSHOTS', () => {
    it('is set to exactly 5', () => {
      expect(MAX_SNAPSHOTS).toBe(5);
    });
  });

  describe('sanitizeForIdb', () => {
    it('removes functions and symbols from objects', () => {
      const input = {
        name: 'Test',
        fn: () => {},
        num: 42,
        nested: {
          str: 'hello',
          innerFn: () => {}
        }
      };
      const sanitized = sanitizeForIdb(input);
      expect(sanitized).toEqual({
        name: 'Test',
        num: 42,
        nested: {
          str: 'hello'
        }
      });
    });

    it('handles arrays and primitives safely', () => {
      expect(sanitizeForIdb([1, 2, 'three'])).toEqual([1, 2, 'three']);
      expect(sanitizeForIdb('simple string')).toBe('simple string');
      expect(sanitizeForIdb(null)).toBeNull();
    });
  });

  describe('get and set with memory/localStorage fallback', () => {
    it('saves and retrieves basic data', async () => {
      const testKey = 'test_key_item';
      const testVal = { id: '123', name: 'Sample' };
      await set(testKey, testVal);
      const retrieved = await get(testKey);
      expect(retrieved).toEqual(testVal);
    });

    it('retrieves from localStorage when key exists there', async () => {
      const testKey = 'test_ls_only';
      const testVal = { profile: { age: 30 } };
      localStorage.setItem(testKey, JSON.stringify(testVal));
      const retrieved = await get(testKey);
      expect(retrieved).toEqual(testVal);
    });
  });

  describe('Snapshots lifecycle', () => {
    it('saves, loads, and limits snapshots to MAX_SNAPSHOTS', async () => {
      const email = 'snap_tester@test.com';
      const bundle = {
        profile: { nickname: 'Tester' },
        foodLogs: [{ id: 'f1', name: 'Apple', imageUrl: 'data:image/png;base64,12345' }],
        biomarkers: { hba1c: 5.4 },
        biomarkerHistory: [{ id: 'b1', date: '2026-08-18' }]
      };

      for (let i = 1; i <= 7; i++) {
        await saveLocalSnapshot(`Snapshot ${i}`, email, bundle);
      }

      const loaded = await loadLocalSnapshots(email);
      expect(loaded.length).toBeLessThanOrEqual(MAX_SNAPSHOTS);
      expect(loaded[0].label).toBe('Snapshot 7');
      // Verify image removed in snapshot
      expect(loaded[0].data.foodLogs[0].imageUrl).toBe('[image_removed_for_snapshot]');
    });

    it('deletes a specific snapshot by id', async () => {
      const email = 'delete_snap@test.com';
      const bundle = {
        profile: { nickname: 'DeleteMe' },
        foodLogs: [],
        biomarkers: {},
        biomarkerHistory: []
      };

      await saveLocalSnapshot('Snap to Delete', email, bundle);
      const snaps = await loadLocalSnapshots(email);
      expect(snaps.length).toBe(1);

      await deleteLocalSnapshot(email, snaps[0].id);
      const remaining = await loadLocalSnapshots(email);
      expect(remaining.length).toBe(0);
    });
  });

  describe('safeSaveToLocalStorage', () => {
    it('preserves existing lastSyncedAt if not overwritten', async () => {
      const key = 'test_safe_save';
      await set(key, { name: 'Initial', lastSyncedAt: 123456789 });
      await safeSaveToLocalStorage(key, { name: 'Updated' });
      const res = await get(key);
      expect(res.name).toBe('Updated');
      expect(res.lastSyncedAt).toBe(123456789);
    });
  });

  describe('clearChatMemoryKeys', () => {
    it('removes front-desk memory keys but keeps unrelated keys', async () => {
      localStorage.setItem('last_sent_payload_demo_x_front_desk', '{}');
      localStorage.setItem('active_session_id_front_desk_none', 's1');
      localStorage.setItem('jobstore_jobs', '{}');
      localStorage.setItem('preferred_language', 'en');
      clearChatMemoryKeys();
      expect(localStorage.getItem('last_sent_payload_demo_x_front_desk')).toBeNull();
      expect(localStorage.getItem('active_session_id_front_desk_none')).toBeNull();
      expect(localStorage.getItem('jobstore_jobs')).toBeNull();
      expect(localStorage.getItem('preferred_language')).toBe('en');
    });
  });

  describe('clearCachedAppData', () => {
    it('removes the email storage key so the next login starts clean', async () => {
      const email = 'logout.probe@gmail.com';
      await set(getStorageKey(email), { profile: { nickname: 'Probe' } });
      expect(await get(getStorageKey(email))).toBeTruthy();
      await clearCachedAppData(email);
      expect(await get(getStorageKey(email))).toBeUndefined();
    });
  });
});
