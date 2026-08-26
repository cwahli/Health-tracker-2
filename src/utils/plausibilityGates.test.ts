import { describe, it, expect } from 'vitest';
import {
  sanitizeNumericInput,
  applyPlausibilityRangeGates,
  generateBiomarkerRecordKey,
} from './plausibilityGates';

describe('Plausibility Range Gates & Sanitizer Engine', () => {
  describe('sanitizeNumericInput', () => {
    it('strips leading zeros from numeric strings without formatting corruption', () => {
      expect(sanitizeNumericInput('01.07')).toEqual({ value: 1.07, sanitizedString: '1.07' });
      expect(sanitizeNumericInput('005.20')).toEqual({ value: 5.2, sanitizedString: '5.2' });
      expect(sanitizeNumericInput(' 0.48 ')).toEqual({ value: 0.48, sanitizedString: '0.48' });
      expect(sanitizeNumericInput(4.3)).toEqual({ value: 4.3, sanitizedString: '4.3' });
      expect(sanitizeNumericInput('')).toEqual({ value: null, sanitizedString: '' });
      expect(sanitizeNumericInput(null)).toEqual({ value: null, sanitizedString: '' });
    });
  });

  describe('applyPlausibilityRangeGates', () => {
    it('auto-scales Hematocrit whole percentages to SI decimal fraction (L/L)', () => {
      // 48 in L/L -> 0.48 L/L
      const res1 = applyPlausibilityRangeGates('hematocrit', 48, 'L/L');
      expect(res1.passed).toBe(true);
      expect(res1.actionTaken).toBe('auto_scaled');
      expect(res1.calibratedValue).toBe(0.48);
      expect(res1.calibratedUnit).toBe('L/L');

      // 48.8 in fraction -> 0.488 L/L
      const res2 = applyPlausibilityRangeGates('hematocrit', 48.8, 'fraction');
      expect(res2.passed).toBe(true);
      expect(res2.actionTaken).toBe('auto_scaled');
      expect(res2.calibratedValue).toBe(0.488);

      // Normal 0.48 L/L passes unscaled
      const res3 = applyPlausibilityRangeGates('hematocrit', 0.48, 'L/L');
      expect(res3.passed).toBe(true);
      expect(res3.actionTaken).toBe('none');
      expect(res3.calibratedValue).toBe(0.48);
    });

    it('converts suspected US mg/dL Serum Calcium entered under mmol/L unit label', () => {
      // 9.4 mg/dL labeled as mmol/L -> ~2.35 mmol/L (9.4 * 0.2495)
      const res = applyPlausibilityRangeGates('serum_calcium', 9.4, 'mmol/L');
      expect(res.passed).toBe(true);
      expect(res.actionTaken).toBe('unit_converted');
      expect(res.calibratedValue).toBeCloseTo(2.345, 2);
      expect(res.calibratedUnit).toBe('mmol/L');

      // Normal 2.35 mmol/L passes untouched
      const normalRes = applyPlausibilityRangeGates('serum_calcium', 2.35, 'mmol/L');
      expect(normalRes.actionTaken).toBe('none');
      expect(normalRes.calibratedValue).toBe(2.35);
    });

    it('converts suspected US mg/dL Inorganic Phosphate entered under mmol/L unit label', () => {
      // 3.5 mg/dL labeled as mmol/L -> ~1.13 mmol/L (3.5 * 0.3229)
      const res = applyPlausibilityRangeGates('serum_inorganic_phosphate', 3.5, 'mmol/L');
      expect(res.passed).toBe(true);
      expect(res.actionTaken).toBe('unit_converted');
      expect(res.calibratedValue).toBeCloseTo(1.13, 2);
      expect(res.calibratedUnit).toBe('mmol/L');
    });

    it('flags LDL Cholesterol unit mismatch when value is in mmol/L scale (< 15) but labeled mg/dL', () => {
      const res = applyPlausibilityRangeGates('ldl', 4.3, 'mg/dL');
      expect(res.passed).toBe(false);
      expect(res.actionTaken).toBe('flagged');
      expect(res.calibratedUnit).toBe('mmol/L');
      expect(res.warning).toContain('labeled mg/dL but is in mmol/L scale');
    });
  });

  describe('generateBiomarkerRecordKey', () => {
    it('generates consistent deterministic composite idempotency keys', () => {
      const key1 = generateBiomarkerRecordKey('user_123', 'ldl', '2026-06-03', 'file_abc');
      const key2 = generateBiomarkerRecordKey('user_123', 'ldl', '2026-06-03', 'file_abc');
      expect(key1).toBe(key2);
      expect(key1).toBe('rec_user_123_ldl_2026-06-03_file_abc');

      const key3 = generateBiomarkerRecordKey('user_123', 'hdl', '2026-06-03', 'file_abc');
      expect(key1).not.toBe(key3);
    });
  });
});
