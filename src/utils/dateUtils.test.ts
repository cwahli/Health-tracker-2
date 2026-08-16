import { describe, it, expect } from 'vitest';
import { extractMostRecentImageDate } from './dateUtils';

describe('extractMostRecentImageDate', () => {
  it('returns null for empty, undefined, or non-array inputs', () => {
    expect(extractMostRecentImageDate(undefined)).toBeNull();
    expect(extractMostRecentImageDate([])).toBeNull();
    expect(extractMostRecentImageDate(['', '   '])).toBeNull();
  });

  it('correctly parses EXIF format YYYY:MM:DD HH:MM:SS', () => {
    const dates = ['2026:05:14 18:30:00'];
    expect(extractMostRecentImageDate(dates)).toBe('2026-05-14');
  });

  it('correctly parses ISO strings', () => {
    const dates = ['2026-06-20T10:15:30.000Z'];
    expect(extractMostRecentImageDate(dates)).toBe('2026-06-20');
  });

  it('selects the most recent date when multiple image dates are provided', () => {
    const dates = [
      '2026-01-10T12:00:00Z',
      '2026:08:15 14:22:00',
      '2026-03-05T08:00:00Z'
    ];
    expect(extractMostRecentImageDate(dates)).toBe('2026-08-15');
  });

  it('handles numeric epoch timestamps', () => {
    const timestamp = new Date('2026-07-04T12:00:00Z').getTime();
    expect(extractMostRecentImageDate([timestamp])).toBe('2026-07-04');
  });
});
