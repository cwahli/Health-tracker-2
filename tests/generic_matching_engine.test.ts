import { describe, it, expect } from 'vitest';
import {
  isGenericZeroNutrientDiluent,
  getZeroNutrientVector,
  calculateGenericTokenCoverage,
  evaluateGenericModifierInversionPenalty
} from '../server_matching_engine';

describe('Generic Matching Engine Module', () => {
  it('identifies ice, water, and diluents generically', () => {
    expect(isGenericZeroNutrientDiluent('ice')).toBe(true);
    expect(isGenericZeroNutrientDiluent('ice cubes')).toBe(true);
    expect(isGenericZeroNutrientDiluent('sparkling water')).toBe(true);
    expect(isGenericZeroNutrientDiluent('tap water')).toBe(true);
    expect(isGenericZeroNutrientDiluent('chicken breast')).toBe(false);
  });

  it('returns zero nutrient vector for diluents', () => {
    const vec = getZeroNutrientVector();
    expect(vec.calories).toBe(0);
    expect(vec.protein).toBe(0);
    expect(vec.totalFat).toBe(0);
    expect(vec.sodium).toBe(0);
  });

  it('calculates token coverage ratio correctly', () => {
    const q1 = ['citrus', 'juice'];
    const c1 = ['Beverages', 'citrus', 'fruit', 'juice', 'drink'];
    const res1 = calculateGenericTokenCoverage(q1, c1);
    expect(res1.ratio).toBe(1.0);
    expect(res1.allMatched).toBe(true);

    const q2 = ['citrus', 'juice'];
    const c2 = ['Green', 'Tea', 'with', 'Citrus'];
    const res2 = calculateGenericTokenCoverage(q2, c2);
    expect(res2.ratio).toBe(0.5);
    expect(res2.allMatched).toBe(false);
  });

  it('evaluates generic modifier inversion penalty for sugar-free and decaf', () => {
    const pen1 = evaluateGenericModifierInversionPenalty('sugar syrup', 'Syrups, sugar free');
    expect(pen1).toBeGreaterThanOrEqual(3000);

    const pen2 = evaluateGenericModifierInversionPenalty('coffee', 'Decaf Instant Coffee');
    expect(pen2).toBeGreaterThanOrEqual(3000);

    const pen3 = evaluateGenericModifierInversionPenalty('sugar syrup', 'Syrups, table blends, corn, refiner, and sugar');
    expect(pen3).toBe(0);
  });

  it('penalizes raw fresh herb leaves when searching for candy / peppermint patty', () => {
    const pen = evaluateGenericModifierInversionPenalty('peppermint patty', 'Peppermint, fresh');
    expect(pen).toBeGreaterThanOrEqual(3000);

    const penFondant = evaluateGenericModifierInversionPenalty('peppermint fondant filling', 'Peppermint, fresh');
    expect(penFondant).toBeGreaterThanOrEqual(3000);
  });
});
