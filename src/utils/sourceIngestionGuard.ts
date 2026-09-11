/**
 * Source Ingestion Guard
 * Enforces allowed biomarker metrics per data ingestion source channel (e.g. wearables, manual, lab results).
 */

export const SOURCE_CHANNEL_ALLOWLIST = new Set([
  'apple_health',
  'google_fit',
  'garmin',
  'whoop',
  'oura',
  'fitbit',
  'withings',
  'wearable',
  'manual',
  'lab_pdf',
  'doctor_note',
  'ocr_scan',
  'agent_inference'
]);

export const WEARABLE_ALLOWED_METRICS = new Set([
  'heart_rate',
  'resting_heart_rate',
  'heart_rate_variability',
  'hrv',
  'steps',
  'sleep_duration',
  'deep_sleep',
  'rem_sleep',
  'vo2_max',
  'respiratory_rate',
  'blood_oxygen',
  'spo2',
  'body_temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'active_calories',
  'resting_calories',
  'weight',
  'body_fat_percentage'
]);

export function isKeyAllowedForSource(key: string, source: string): boolean {
  if (!key) return false;
  const s = (source || 'manual').toLowerCase().trim();
  const k = key.toLowerCase().trim();

  // If source is a wearable, only allowed wearable metrics pass
  if (['apple_health', 'google_fit', 'garmin', 'whoop', 'oura', 'fitbit', 'withings', 'wearable'].includes(s)) {
    return WEARABLE_ALLOWED_METRICS.has(k);
  }

  // Lab reports and manual entry allow clinical biomarkers
  return true;
}

export function validateSourceIngestion<T extends { key?: string; biomarker?: string }>(
  observations: T[],
  source: string
): { valid: T[]; rejected: T[] } {
  const valid: T[] = [];
  const rejected: T[] = [];

  for (const obs of observations) {
    const k = obs.key || obs.biomarker || '';
    if (isKeyAllowedForSource(k, source)) {
      valid.push(obs);
    } else {
      rejected.push(obs);
    }
  }

  return { valid, rejected };
}

export function filterAllowedBiomarkersForSource<T extends { key?: string; biomarker?: string }>(
  observations: T[],
  source: string
): T[] {
  return validateSourceIngestion(observations, source).valid;
}
