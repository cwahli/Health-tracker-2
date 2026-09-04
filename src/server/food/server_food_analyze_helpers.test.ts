import { describe, it, expect } from 'vitest';
import { loosenQuery, cleanQuery, detectChainKeyFromText } from './server_food_analyze_helpers';

describe('F-8.10 shard 1 — DB-search query normalization', () => {
  it('loosenQuery strips brand adjectives and normalizes plurals', () => {
    expect(loosenQuery('Tesco Bananas')).toBe('banana');
    expect(loosenQuery('grilled salmon')).toBe('salmon');
    expect(loosenQuery('strawberries')).toBe('strawberry');
    expect(loosenQuery('tomatoes')).toBe('tomato');
    expect(loosenQuery('')).toBe('');
  });

  it('cleanQuery strips parentheticals, maps Indonesian staples, and raws bare meats', () => {
    expect(cleanQuery('Chicken Breast (200g)')).toBe('raw chicken breast');
    expect(cleanQuery('nasi goreng')).toBe('cooked rice goreng');
    expect(cleanQuery('kentang')).toBe('potato');
    // Chain-qualified meats keep their preparation context
    expect(cleanQuery('kfc chicken burger')).toBe('kfc chicken burger');
    // Container/prep words are stripped first, then bare meats are rawed
    expect(cleanQuery('grilled salmon')).toBe('raw salmon');
  });

  it('detectChainKeyFromText matches static chain patterns and passes plain food through', () => {
    expect(detectChainKeyFromText("Sainsbury's Scottish Oats")).toBe('sainsbury');
    expect(detectChainKeyFromText('Yolk steak bowl')).toBe('yolk');
    expect(detectChainKeyFromText('plain grilled salmon')).toBeUndefined();
    expect(detectChainKeyFromText('')).toBeUndefined();
  });
});
