import { describe, it, expect } from 'vitest';
import {
  isKeyAllowedForSource,
  validateSourceIngestion,
  filterAllowedBiomarkersForSource,
} from './sourceIngestionGuard';

describe('Source Channel Ingestion Guard', () => {
  it('allows standard wearable metrics for Google Fit and Apple Health', () => {
    expect(isKeyAllowedForSource('google_fit', 'steps')).toBe(true);
    expect(isKeyAllowedForSource('google_fit', 'heart_rate')).toBe(true);
    expect(isKeyAllowedForSource('google_fit', 'sleep_duration')).toBe(true);
    expect(isKeyAllowedForSource('apple_health', 'blood_pressure')).toBe(true);
    expect(isKeyAllowedForSource('apple_health', 'body_weight')).toBe(true);
    expect(isKeyAllowedForSource('whoop', 'resting_heart_rate')).toBe(true);
  });

  it('rejects clinical lab analytes from wearable channels', () => {
    expect(isKeyAllowedForSource('google_fit', 'wbc')).toBe(false);
    expect(isKeyAllowedForSource('google_fit', 'egfr')).toBe(false);
    expect(isKeyAllowedForSource('apple_health', 'lymphocyte_count')).toBe(false);
    expect(isKeyAllowedForSource('whoop', 'total_cholesterol')).toBe(false);
    expect(isKeyAllowedForSource('garmin', 'creatinine')).toBe(false);
  });

  it('permits all clinical biomarkers for clinical report channels', () => {
    expect(isKeyAllowedForSource('lab_ocr_pdf', 'wbc')).toBe(true);
    expect(isKeyAllowedForSource('nhs_emis_table', 'egfr')).toBe(true);
    expect(isKeyAllowedForSource('manual_entry', 'creatinine')).toBe(true);
  });

  it('validates a batch and catches unauthorized keys', () => {
    const result = validateSourceIngestion('google_fit', ['steps', 'heart_rate', 'creatinine', 'wbc']);
    expect(result.valid).toBe(false);
    expect(result.rejectedKeys).toEqual(['creatinine', 'wbc']);
    expect(result.error).toContain('SchemaValidationError');
  });

  it('filters incoming biomarker objects separating allowed and rejected metrics', () => {
    const incoming = {
      steps: 8400,
      heart_rate: 68,
      wbc: 5.4,
      egfr: 92,
    };
    const { allowed, rejected, rejectedKeys } = filterAllowedBiomarkersForSource('google_fit', incoming);
    expect(allowed).toEqual({ steps: 8400, heart_rate: 68 });
    expect(rejected).toEqual({ wbc: 5.4, egfr: 92 });
    expect(rejectedKeys).toEqual(['wbc', 'egfr']);
  });
});
