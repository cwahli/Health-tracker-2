import { describe, it, expect } from 'vitest';
import { evaluateGenericModifierInversionPenalty } from './server_matching_engine';

describe('Modifier Inversions', () => {
  it('detects false friend when query has milk but candidate is dry oats', () => {
    const penalty = evaluateGenericModifierInversionPenalty("Sainsbury oat with milk", "Sainsbury's Scottish Whole Rolled Oats");
    expect(penalty).toBeGreaterThan(1000);
  });
});
