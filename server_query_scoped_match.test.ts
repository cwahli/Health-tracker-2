import { describe, it, expect } from 'vitest';
import { pickQueryScopedMatch, filterMatchesForQuery } from './server_query_scoped_match.js';

describe('query-scoped component bind (scout + resolver + backend)', () => {
  const pool = [
    { id: '172522', name: 'flour tortilla', source: 'internal_catalog', searchQuery: 'flour tortilla' },
    { id: '171327', name: 'Spices, onion powder', source: 'off', searchQuery: 'crispy onions' },
    { id: '171057', name: 'Chicken, breaded, fried', source: 'usda', searchQuery: 'crispy fried chicken breast' },
    { id: '173430', name: 'Butter, without salt', source: 'usda', searchQuery: 'unsalted butter' },
    { id: '174780', name: 'Salt, table', source: 'usda', searchQuery: 'table salt' },
    { id: '169680', name: 'Wheat flour, white, enriched', source: 'internal_catalog', searchQuery: 'enriched wheat flour' },
  ];

  it('chicken query cannot steal the crispy-onions resolver row', () => {
    const hit = pickQueryScopedMatch('crispy fried chicken breast', pool);
    expect(hit?.id).toBe('171057');
    expect(hit?.id).not.toBe('171327');
  });

  it('flour ingredient cannot steal the wrap tortilla row', () => {
    const hit = pickQueryScopedMatch('enriched wheat flour', pool);
    expect(hit?.id).toBe('169680');
    expect(hit?.id).not.toBe('172522');
  });

  it('table salt cannot steal the butter row', () => {
    const hit = pickQueryScopedMatch('table salt', pool);
    expect(hit?.id).toBe('174780');
    expect(hit?.id).not.toBe('173430');
  });

  it('findBestMatch-style scan only sees this query\'s rows', () => {
    const scoped = filterMatchesForQuery('crispy fried chicken breast', pool);
    expect(scoped.map((r) => r.id)).toEqual(['171057']);
  });

  it('returns null when resolver has not produced a row for this query (honest MISS)', () => {
    expect(pickQueryScopedMatch('romaine lettuce raw', pool)).toBeNull();
  });
});
