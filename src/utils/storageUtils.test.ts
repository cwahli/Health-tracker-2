import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStorageKey, getSnapshotKey, MAX_SNAPSHOTS } from './storageUtils';

describe('Storage and Snapshot Utils', () => {
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
});
