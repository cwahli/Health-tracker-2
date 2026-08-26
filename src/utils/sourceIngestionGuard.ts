/**
 * Source Channel Ingestion Guard
 * Enforces strict channel type boundaries to prevent cross-contamination
 * (e.g., wearable devices syncing clinical lab analytes like WBC, eGFR, Lymphocytes).
 */

export const WEARABLE_ALLOWED_METRICS = new Set([
  'steps',
  'step_count',
  'resting_heart_rate',
  'heart_rate',
  'pulse_rate',
  'active_energy',
  'active_minutes',
  'calories',
  'calories_burned',
  'sleep_duration',
  'sleep_hours',
  'sleep_efficiency',
  'body_weight',
  'weight',
  'weight_kg',
  'blood_pressure',
  'systolic_blood_pressure',
  'diastolic_blood_pressure',
  'distance',
  'distance_km',
  'floors_climbed',
  'vo2_max',
  'respiratory_rate',
  'oxygen_saturation',
  'spo2',
]);

export const SOURCE_CHANNEL_ALLOWLIST: Record<string, Set<string>> = {
  google_fit: WEARABLE_ALLOWED_METRICS,
  apple_health: WEARABLE_ALLOWED_METRICS,
  fitbit: WEARABLE_ALLOWED_METRICS,
  whoop: WEARABLE_ALLOWED_METRICS,
  oura: WEARABLE_ALLOWED_METRICS,
  garmin: WEARABLE_ALLOWED_METRICS,
  health_connect: WEARABLE_ALLOWED_METRICS,
  // Clinical pipelines permit all mapped clinical biomarkers
  lab_ocr_pdf: new Set(['*']),
  nhs_emis_table: new Set(['*']),
  manual_entry: new Set(['*']),
  lab_csv: new Set(['*']),
  doctor_letter: new Set(['*']),
};

/**
 * Checks if a biomarker key is authorized for ingestion from the given source.
 */
export function isKeyAllowedForSource(source: string, key: string): boolean {
  if (!source) return true;
  const sourceLower = source.toLowerCase().trim();
  const allowlist = SOURCE_CHANNEL_ALLOWLIST[sourceLower];

  // If source is not registered as a wearable integration, default to permitting clinical intake
  if (!allowlist) return true;

  // Wildcard permits all
  if (allowlist.has('*')) return true;

  const keyClean = (key || '').toLowerCase().replace(/[\s-]/g, '_');
  return allowlist.has(keyClean);
}

/**
 * Validates a batch of biomarker keys against the source channel.
 */
export function validateSourceIngestion(
  source: string,
  biomarkerKeys: string[]
): { valid: boolean; rejectedKeys: string[]; error?: string } {
  if (!source || !biomarkerKeys || biomarkerKeys.length === 0) {
    return { valid: true, rejectedKeys: [] };
  }

  const rejectedKeys = biomarkerKeys.filter((k) => !isKeyAllowedForSource(source, k));

  if (rejectedKeys.length > 0) {
    return {
      valid: false,
      rejectedKeys,
      error: `SchemaValidationError: Source '${source}' is not authorized to ingest clinical lab analytes: [${rejectedKeys.join(', ')}]`,
    };
  }

  return { valid: true, rejectedKeys: [] };
}

/**
 * Filters incoming biomarker records, rejecting unwhitelisted metrics for the source.
 */
export function filterAllowedBiomarkersForSource(
  source: string,
  biomarkers: Record<string, any>
): { allowed: Record<string, any>; rejected: Record<string, any>; rejectedKeys: string[] } {
  const allowed: Record<string, any> = {};
  const rejected: Record<string, any> = {};
  const rejectedKeys: string[] = [];

  if (!biomarkers) {
    return { allowed, rejected, rejectedKeys };
  }

  Object.entries(biomarkers).forEach(([key, value]) => {
    if (isKeyAllowedForSource(source, key)) {
      allowed[key] = value;
    } else {
      rejected[key] = value;
      rejectedKeys.push(key);
    }
  });

  return { allowed, rejected, rejectedKeys };
}
