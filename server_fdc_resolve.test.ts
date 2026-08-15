import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankAndClassifyCandidates } from './server_fdc_resolve.js';
import { checkCategoryAndStateCompatibility } from './server_pure_helpers.js';

describe('scoreCandidate', () => {
  it('penalizes tuna salad when querying mixed salad greens', () => {
    const q = 'mixed salad greens';
    const c1 = { description: 'Fish, tuna salad' };
    const c2 = { description: 'Lettuce, mixed greens, raw' };
    
    const s1 = scoreCandidate(q, c1);
    const s2 = scoreCandidate(q, c2);
    
    expect(s2).toBeGreaterThan(s1);
  });
  
  it('penalizes dried yolk when querying boiled egg', () => {
    const q = 'boiled egg';
    const c1 = { description: 'Egg, yolk, dried' };
    const c2 = { description: 'Egg, whole, hard boiled' };
    
    const s1 = scoreCandidate(q, c1);
    const s2 = scoreCandidate(q, c2);
    
    expect(s2).toBeGreaterThan(s1);
  });
});

describe('FALSE_FRIEND refuse (BUG-03)', () => {
  it('refuses onion powder 171327 for crispy fried chicken breast', () => {
    const r = rankAndClassifyCandidates('crispy fried chicken breast', [
      { fdcId: '171327', description: 'Spices, onion powder' },
    ]);
    expect(r.bestMatch).toBeNull();
    expect(checkCategoryAndStateCompatibility('crispy fried chicken breast', 'Spices, onion powder').compatible).toBe(false);
  });

  it('refuses flour tortilla 172522 for enriched wheat flour', () => {
    const r = rankAndClassifyCandidates('enriched wheat flour', [
      { fdcId: '172522', description: 'Tortillas, ready-to-bake or -fry, flour' },
    ]);
    expect(r.bestMatch).toBeNull();
    expect(checkCategoryAndStateCompatibility('enriched wheat flour', 'flour tortilla').compatible).toBe(false);
  });

  it('refuses butter 173430 for table salt', () => {
    const r = rankAndClassifyCandidates('table salt', [
      { fdcId: '173430', description: 'Butter, without salt' },
    ]);
    expect(r.bestMatch).toBeNull();
    expect(checkCategoryAndStateCompatibility('table salt', 'Butter, without salt').compatible).toBe(false);
  });

  it('still accepts a real poultry / flour / salt hit', () => {
    expect(rankAndClassifyCandidates('grilled chicken breast', [
      { fdcId: '171077', description: 'Chicken, broilers or fryers, breast, meat only, grilled' },
    ]).bestMatch?.fdcId).toBe('171077');
    expect(rankAndClassifyCandidates('enriched wheat flour', [
      { fdcId: '169680', description: 'Wheat flour, white, all-purpose, enriched, bleached' },
    ]).bestMatch?.fdcId).toBe('169680');
    expect(rankAndClassifyCandidates('table salt', [
      { fdcId: '174780', description: 'Salt, table' },
    ]).bestMatch?.fdcId).toBe('174780');
  });
});
