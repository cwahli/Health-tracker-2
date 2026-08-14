import { describe, it, expect } from 'vitest';
import { classifyCatalogHit, replayScoutAgainstCatalog, catalogReplayGreen } from './goldenReplay';
import { buildTransportInvariants } from './goldenJourney';
import { lookupCanonicalBaseFood } from '../../server_food_db.js';

const picnicScout = {
  items: [
    {
      originalName: 'Granola',
      components: [
        { searchQuery: 'plain yogurt' },
        { searchQuery: 'granola' },
        { searchQuery: 'mixed berries fruit compote' },
        { searchQuery: 'sliced almonds' },
        { searchQuery: 'seedless raisins' },
      ],
    },
    {
      originalName: 'Vegetarian wrap',
      components: [
        { searchQuery: 'flour tortilla' },
        { searchQuery: 'falafel' },
        { searchQuery: 'hummus' },
        { searchQuery: 'feta cheese' },
      ],
    },
    {
      originalName: 'Chicken Avocado Salad Bowl',
      components: [
        { searchQuery: 'grilled chicken breast' },
        { searchQuery: 'raw avocado' },
        { searchQuery: 'hard boiled egg' },
        { searchQuery: 'romaine lettuce raw' },
      ],
    },
    {
      originalName: 'Croissants',
      components: [{ searchQuery: 'butter croissant' }],
    },
  ],
};

describe('catalog replay (no Gemini)', () => {
  it('classifies a catalog hit as catalog and a poison id as mismatch', () => {
    expect(classifyCatalogHit('falafel', { fdcId: 'falafel_canonical', name: 'falafel' })).toBe('catalog');
    expect(classifyCatalogHit('mixed berries', { fdcId: '174113', name: 'POWERADE' })).toBe('mismatch');
    expect(classifyCatalogHit('mystery stew', null)).toBe('no_match');
  });

  it('resolves the picnic scout against the live dictionary', () => {
    const rows = replayScoutAgainstCatalog(picnicScout, lookupCanonicalBaseFood);
    const byQ = Object.fromEntries(rows.map((r) => [r.query, r]));
    expect(byQ['plain yogurt'].identityPass).toBe(true);
    expect(byQ['plain yogurt'].matchId).toBe('170903');
    expect(byQ['falafel'].identityPass).toBe(true);
    expect(byQ['falafel'].matchId).toBe('falafel_canonical');
    expect(byQ['butter croissant'].identityPass).toBe(true);
    expect(catalogReplayGreen(rows)).toBe(true);
  });

  it('stays red when lookup misses', () => {
    const rows = replayScoutAgainstCatalog(picnicScout, () => null);
    expect(catalogReplayGreen(rows)).toBe(false);
    expect(rows.every((r) => r.phase === 'no_match')).toBe(true);
  });
});

describe('transport auto-checks', () => {
  it('classifies the wrapped 429 as quota, not a bad photo', () => {
    const err = `Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: {"error":{"code":429,"message":"You exceeded your current quota... model: gemini-3.5-flash-lite\\nPlease retry in 5.905781323s.","status":"RESOURCE_EXHAUSTED"}})`;
    const log = `[Vision Scout Attempt 1 Failed] Error: ${err}\n[Vision Scout] Waiting 3000ms before retry...\n[Vision Scout Attempt 2 Failed]\n[Vision Scout Attempt 3 Failed]\n[Vision Scout Failed Permanently]`;
    const inv = buildTransportInvariants({ logText: log, errorText: err });
    const ids = inv.map((i) => i.id);
    expect(ids).toContain('tr_quota_429');
    expect(ids).toContain('tr_misleading_image_wrap');
    expect(ids).toContain('tr_retry_storm');
    expect(ids).toContain('tr_stage_died');
    expect(inv.find((i) => i.id === 'tr_quota_429')?.actual).toMatch(/429/);
  });
});
