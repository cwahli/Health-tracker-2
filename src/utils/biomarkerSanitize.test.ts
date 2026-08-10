import { describe, it, expect } from 'vitest';
import {
  isBiomarkerValueImprobable,
  sanitizeBiomarkerHistoryOnLoad,
  normalizeHistoricalTelemetryErrors,
  parseNormalRangeBounds,
} from './biomarkers';

describe('parseNormalRangeBounds', () => {
  it('parses Aim under 5.0', () => {
    const b = parseNormalRangeBounds('Aim under 5.0');
    expect(b.max).toBe(5);
  });
});

describe('isBiomarkerValueImprobable', () => {
  it('flags 195 mmol/L total cholesterol', () => {
    expect(isBiomarkerValueImprobable('total_cholesterol', 195, 'Aim under 5.0')).toBe(true);
  });
  it('flags 42.1 hematocrit as %', () => {
    expect(isBiomarkerValueImprobable('hematocrit', 42.1, '0.36-0.50')).toBe(true);
  });
  it('flags 14.5 hemoglobin as g/dL when unit is g/L', () => {
    expect(isBiomarkerValueImprobable('hemoglobin', 14.5, '120-180')).toBe(true);
  });
});

describe('sanitizeBiomarkerHistoryOnLoad', () => {
  it('converts 195 mg/dL-style total cholesterol to ~5 mmol/L', () => {
    const history = [
      {
        id: '1',
        date: '08-08-2026',
        biomarkers: { total_cholesterol: 195 },
      },
      {
        id: '2',
        date: '02-08-2026',
        biomarkers: { total_cholesterol: 6.1 },
      },
    ];
    const { history: cleaned, fixedCount, current } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(fixedCount).toBeGreaterThan(0);
    const aug8 = cleaned.find((h) => String(h.date).includes('08'));
    // After normalize, 195 should become ~5.04 mmol/L (mg/dL convert) not stay 195
    const v = Number(aug8?.biomarkers?.total_cholesterol ?? current.total_cholesterol);
    expect(v).toBeLessThan(30);
    expect(v).toBeGreaterThan(3);
  });

  it('fixes hematocrit 42.1 -> 0.421', () => {
    const history = [{ id: '1', date: '08-08-2026', biomarkers: { hematocrit: 42.1 } }];
    const { history: cleaned } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(Number(cleaned[0].biomarkers.hematocrit)).toBeCloseTo(0.421, 2);
  });
});
