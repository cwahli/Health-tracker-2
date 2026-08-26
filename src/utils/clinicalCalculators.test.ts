import { describe, it, expect } from 'vitest';
import {
  calculateMifflinStJeor,
  calculateTgHdlRatio,
  calculateCkdEpi2021,
  CLINICAL_CALCULATOR_REGISTRY,
} from './clinicalCalculators';
import { UserProfile } from '../types';

describe('Clinical Calculator Engine', () => {
  describe('calculateMifflinStJeor', () => {
    it('calculates exact energy target for baseline Asian profile', () => {
      const profile: UserProfile = {
        weight: 62,
        height: 170,
        age: 35,
        gender: 'male',
        ethnicity: 'Chinese Asian',
      };

      const res = calculateMifflinStJeor(profile);
      expect(res.id).toBe('mifflin_st_jeor');
      expect(res.values.estimatedCalories).toBe(1665);
      expect(res.values.targetBmi).toBe(21);
      expect(res.values.normalMax).toBe(22.9);
      expect(res.values.currentBmi).toBe(21.5);
      expect(res.diagnosticSummary).toBe('Normal weight');
    });

    it('calculates dynamic target calories for non-baseline female profile', () => {
      const profile: UserProfile = {
        weight: 80,
        height: 160,
        age: 40,
        gender: 'female',
        ethnicity: 'Caucasian',
      };

      const res = calculateMifflinStJeor(profile);
      expect(res.values.targetBmi).toBe(21.7);
      expect(res.values.normalMax).toBe(24.9);
      expect(res.values.currentBmi).toBe(31.2);
      expect(res.diagnosticSummary).toBe('Obese');
      expect(res.values.estimatedCalories).toBeGreaterThan(1200);
    });
  });

  describe('calculateTgHdlRatio', () => {
    it('calculates optimal atherogenic ratio correctly in mg/dL', () => {
      const profile: UserProfile = {};
      const res = calculateTgHdlRatio(profile, { tg: 80, hdl: 55, unit: 'mg/dl' });
      expect(res.values.ratio).toBe(1.45);
      expect(res.diagnosticSummary).toContain('Optimal');
    });

    it('calculates elevated ratio correctly in mmol/L', () => {
      const profile: UserProfile = {};
      // TG: 2.5 mmol/L (~221 mg/dL), HDL: 0.9 mmol/L (~34.8 mg/dL) -> ratio ~ 6.35
      const res = calculateTgHdlRatio(profile, { tg: 2.5, hdl: 0.9, unit: 'mmol/l' });
      expect(res.values.ratio).toBeGreaterThan(3.0);
      expect(res.diagnosticSummary).toContain('Elevated');
    });
  });

  describe('calculateCkdEpi2021', () => {
    it('calculates normal filtration for healthy adult female', () => {
      const profile: UserProfile = { age: 30, gender: 'female' };
      const res = calculateCkdEpi2021(profile, { creatinine: 0.7, age: 30, gender: 'female' });
      expect(res.values.egfr).toBeGreaterThanOrEqual(90);
      expect(res.diagnosticSummary).toContain('Stage 1');
    });

    it('calculates decreased filtration for elevated creatinine', () => {
      const profile: UserProfile = { age: 70, gender: 'male' };
      const res = calculateCkdEpi2021(profile, { creatinine: 2.2, age: 70, gender: 'male' });
      expect(res.values.egfr).toBeLessThan(60);
      expect(res.diagnosticSummary).toContain('Stage 3');
    });
  });

  describe('CLINICAL_CALCULATOR_REGISTRY', () => {
    it('contains all core calculator definitions', () => {
      expect(CLINICAL_CALCULATOR_REGISTRY.mifflin_st_jeor).toBeDefined();
      expect(CLINICAL_CALCULATOR_REGISTRY.tg_hdl_ratio).toBeDefined();
      expect(CLINICAL_CALCULATOR_REGISTRY.ckd_epi_2021).toBeDefined();
    });
  });
});
