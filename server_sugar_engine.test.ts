import { describe, it, expect } from 'vitest';
import { deduceSugarBreakdown } from './server_sugar_engine.js';

describe('Sugar Engine Structural Tests', () => {
  describe('BUG-06 bakery added sugar', () => {
    it('treats cinnamon roll + cane sugar glaze as added sugar, not 0.2g', () => {
      const r = deduceSugarBreakdown({
        totalSugar: 37.4,
        addedSugarPrinted: null,
        carbohydrates: 97,
        totalFibre: 3,
        physicalForm: 'SOLID_GRAIN_STARCH',
        foodName: 'Cinnamon roll',
        ingredientsList: 'enriched wheat flour, unsalted butter, cane sugar, ground cinnamon',
      });
      expect(r.addedSugar).toBeGreaterThan(20);
      expect(r.addedSugar).toBeLessThanOrEqual(37.4);
    });

    it('still zeros added sugar on unsweetened grain (rice)', () => {
      const r = deduceSugarBreakdown({
        totalSugar: 0.2,
        foodName: 'cooked white rice',
        physicalForm: 'SOLID_GRAIN_STARCH',
      });
      expect(r.addedSugar).toBe(0);
      expect(r.sugar).toBe(0.2);
    });
  });

  describe('Fruit and Citrus Beverage Matrix', () => {
    it('derives natural fructose for fresh pure orange juice without added sugar', () => {
      const r = deduceSugarBreakdown({
        foodName: 'Es Jeruk Murni (Unsweetened Orange Juice)',
        carbohydrates: 22,
        totalFibre: 0.5,
        physicalForm: 'LIQUID_BEVERAGE',
        foodType: 'beverage',
        ingredientsList: 'fresh squeezed orange juice, ice',
      });
      expect(r.addedSugar).toBe(0);
      expect(r.naturalSugar).toBeGreaterThanOrEqual(18);
      expect(r.sugar).toBe(r.naturalSugar);
      expect(r.sugar).toBeLessThanOrEqual(22);
    });

    it('preserves natural fruit sugar when added syrup is present in sweetened orange juice', () => {
      const r = deduceSugarBreakdown({
        foodName: 'Es Jeruk',
        carbohydrates: 26,
        totalFibre: 0.5,
        physicalForm: 'LIQUID_BEVERAGE',
        foodType: 'beverage',
        ingredientsList: 'fresh orange juice, simple sugar syrup, water, ice',
      });
      expect(r.addedSugar).toBeGreaterThan(10);
      expect(r.naturalSugar).toBeGreaterThan(0);
      expect(r.sugar).toBe(Number((r.addedSugar + r.naturalSugar).toFixed(1)));
      expect(r.sugar).toBeGreaterThan(r.addedSugar);
    });
  });

  describe('Sweetened Drinks vs Unsweetened Staples', () => {
    it('correctly attributes 100% of tea carbs as added sugar for Es Teh Manis', () => {
      const r = deduceSugarBreakdown({
        foodName: 'Es Teh Manis',
        carbohydrates: 18,
        totalFibre: 0,
        physicalForm: 'LIQUID_BEVERAGE',
        ingredientsList: 'black tea, cane sugar, water, ice',
      });
      expect(r.addedSugar).toBe(18);
      expect(r.sugar).toBe(18);
      expect(r.naturalSugar).toBe(0);
    });

    it('maintains 0 added sugar for French Fries and Nasi Putih', () => {
      const fries = deduceSugarBreakdown({
        foodName: 'French Fries',
        carbohydrates: 45,
        totalFibre: 3.8,
        physicalForm: 'SOLID_GRAIN_STARCH',
      });
      expect(fries.addedSugar).toBe(0);
      expect(fries.sugar).toBeLessThanOrEqual(1.5);

      const rice = deduceSugarBreakdown({
        foodName: 'Nasi Putih',
        carbohydrates: 56,
        totalFibre: 0.8,
        physicalForm: 'SOLID_GRAIN_STARCH',
      });
      expect(rice.addedSugar).toBe(0);
      expect(rice.sugar).toBeLessThanOrEqual(1.5);
    });

    it('maintains 0 added sugar and 0 total sugar for grilled fish (Ikan Bakar)', () => {
      const fish = deduceSugarBreakdown({
        foodName: 'Ikan Bakar',
        carbohydrates: 0.5,
        totalFibre: 0,
        physicalForm: 'SOLID_MEAT_FISH',
      });
      expect(fish.addedSugar).toBe(0);
      expect(fish.sugar).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Dessert & Bakery Sweets', () => {
    it('accurately identifies Brownie Bar carbs as added sugar', () => {
      const r = deduceSugarBreakdown({
        foodName: 'Brownies Bar',
        carbohydrates: 48,
        totalFibre: 2,
        physicalForm: 'SOLID_GRAIN_STARCH',
        ingredientsList: 'flour, butter, cocoa, cane sugar, eggs, chocolate chips',
      });
      expect(r.addedSugar).toBeGreaterThan(30);
      expect(r.sugar).toBeGreaterThanOrEqual(r.addedSugar);
    });
  });

  describe('Invariant: Total Sugar >= Added Sugar', () => {
    it('guarantees Total Sugar >= Added Sugar even if input totalSugar is smaller or null', () => {
      const r = deduceSugarBreakdown({
        totalSugar: null,
        addedSugarPrinted: 25,
        carbohydrates: 30,
        totalFibre: 0,
        foodName: 'Energy Bar',
      });
      expect(r.addedSugar).toBe(25);
      expect(r.sugar).toBeGreaterThanOrEqual(25);
    });
  });
});

