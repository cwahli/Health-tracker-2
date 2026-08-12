import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankAndClassifyCandidates } from './server_fdc_resolve.js';

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
