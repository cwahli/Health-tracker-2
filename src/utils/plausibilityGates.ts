/**
 * Physiological Plausibility Range Gates & Numeric Sanitization
 * Enforces pre-commit validation to catch scale errors, US/SI unit mismatches,
 * and malformed regex extractions (e.g., leading-zero strings).
 */

import { ANALYTE_CONVERSIONS } from './analyteConversions';
import { getMappedBiomarkerKey, biomarkerDefinitions, parseNormalRangeBounds } from './biomarkers';

export interface PlausibilityGateResult {
  passed: boolean;
  actionTaken: 'none' | 'auto_scaled' | 'unit_converted' | 'flagged';
  originalValue: number;
  originalUnit: string;
  calibratedValue: number;
  calibratedUnit: string;
  auditNote?: string;
  warning?: string;
}

/**
 * Sanitizes numeric input strings, stripping leading zeros and whitespace artifacts
 * (e.g., '01.07' -> 1.07, ' 005.2 ' -> 5.2).
 */
export function sanitizeNumericInput(raw: any): { value: number | null; sanitizedString: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, sanitizedString: '' };
  }

  if (typeof raw === 'number') {
    return isNaN(raw) ? { value: null, sanitizedString: '' } : { value: raw, sanitizedString: String(raw) };
  }

  const s = String(raw).trim();
  const parsed = parseFloat(s);

  if (isNaN(parsed)) {
    return { value: null, sanitizedString: s };
  }

  // Format cleanly without arbitrary string leading zeros
  const sanitizedString = String(parsed);
  return { value: parsed, sanitizedString };
}

/**
 * Applies physiological range gates and auto-calibration for standard clinical markers.
 */
export function applyPlausibilityRangeGates(
  rawKey: string,
  rawValue: number,
  parsedUnit: string = '',
  normalRangeStr?: string
): PlausibilityGateResult {
  const canonical = getMappedBiomarkerKey(rawKey) || rawKey.toLowerCase();
  const unitLower = (parsedUnit || '').toLowerCase().trim();
  const def = biomarkerDefinitions.find((d) => d.key === canonical);
  const effectiveRange = normalRangeStr || def?.normalRange;
  const bounds = parseNormalRangeBounds(effectiveRange);

  const defaultPass: PlausibilityGateResult = {
    passed: true,
    actionTaken: 'none',
    originalValue: rawValue,
    originalUnit: parsedUnit,
    calibratedValue: rawValue,
    calibratedUnit: parsedUnit || def?.unit || '',
  };

  if (isNaN(rawValue) || rawValue <= 0) {
    return defaultPass;
  }

  // 1. Hematocrit Scale Error Gate (0.35 - 0.55 L/L)
  // If recorded as whole percentage (e.g., 48 or 48.8) when unit is L/L or fraction, auto-convert to decimal fraction (0.48 / 0.488)
  if (canonical === 'hematocrit') {
    const isFractionUnit = unitLower === 'l/l' || unitLower === 'l/l ' || unitLower === 'fraction' || unitLower === 'ratio' || unitLower === '';
    if (isFractionUnit && rawValue > 1.0) {
      const scaled = parseFloat((rawValue / 100).toFixed(4));
      return {
        passed: true,
        actionTaken: 'auto_scaled',
        originalValue: rawValue,
        originalUnit: parsedUnit || 'L/L',
        calibratedValue: scaled,
        calibratedUnit: 'L/L',
        auditNote: `Hematocrit percentage (${rawValue}%) automatically scaled to SI decimal fraction (${scaled} L/L).`,
      };
    }
  }

  // 2. Serum Calcium US vs SI Unit Mismatch Gate (2.0 - 2.8 mmol/L vs 8.5 - 10.5 mg/dL)
  // If value is > 6.0 and unit is labeled mmol/L, it is almost certainly in US units (mg/dL) (e.g. 9.4 mg/dL = ~2.35 mmol/L)
  if (canonical === 'calcium' || canonical === 'serum_calcium' || canonical === 'serum_adjusted_calcium') {
    if ((unitLower === 'mmol/l' || unitLower === 'mmol/l' || unitLower === '') && rawValue > 6.0 && rawValue <= 15.0) {
      const converted = parseFloat((rawValue * 0.2495).toFixed(3));
      return {
        passed: true,
        actionTaken: 'unit_converted',
        originalValue: rawValue,
        originalUnit: parsedUnit || 'mmol/L',
        calibratedValue: converted,
        calibratedUnit: 'mmol/L',
        auditNote: `Serum Calcium value (${rawValue}) was entered with mmol/L label but matches US mg/dL scale. Converted to ${converted} mmol/L (×0.2495).`,
      };
    }
  }

  // 3. Inorganic Phosphate US vs SI Unit Mismatch Gate (0.8 - 1.5 mmol/L vs 2.5 - 4.5 mg/dL)
  // If value is > 2.5 and unit is labeled mmol/L, it is in US units (mg/dL) (e.g. 3.5 mg/dL = ~1.13 mmol/L)
  if (canonical === 'serum_inorganic_phosphate' || canonical === 'phosphate') {
    if ((unitLower === 'mmol/l' || unitLower === '') && rawValue > 2.2 && rawValue <= 8.0) {
      const converted = parseFloat((rawValue * 0.3229).toFixed(3));
      return {
        passed: true,
        actionTaken: 'unit_converted',
        originalValue: rawValue,
        originalUnit: parsedUnit || 'mmol/L',
        calibratedValue: converted,
        calibratedUnit: 'mmol/L',
        auditNote: `Inorganic Phosphate value (${rawValue}) was entered with mmol/L label but matches US mg/dL scale. Converted to ${converted} mmol/L (×0.3229).`,
      };
    }
  }

  // 4. LDL Cholesterol Unit Mismatch Gate (1.0 - 8.0 mmol/L vs 50 - 250 mg/dL)
  // If value is < 15.0 and unit is labeled mg/dL, it is in mmol/L (e.g. 4.3 mmol/L mistakenly labeled 4.3 mg/dL)
  if (canonical === 'ldl' || canonical === 'calculated_ldl_cholesterol' || canonical === 'total_cholesterol' || canonical === 'hdl') {
    if (unitLower === 'mg/dl' && rawValue < 15.0) {
      return {
        passed: false,
        actionTaken: 'flagged',
        originalValue: rawValue,
        originalUnit: 'mg/dL',
        calibratedValue: rawValue,
        calibratedUnit: 'mmol/L',
        warning: `${def?.name || canonical} value (${rawValue}) is labeled mg/dL but is in mmol/L scale (< 15). Should be labeled mmol/L.`,
        auditNote: `Unit label mismatch flagged: ${rawValue} mg/dL is an impossible lipid reading (expected 50-250 mg/dL). Preserving ${rawValue} mmol/L.`,
      };
    }
  }

  // 5. Plausible Bounds Gate Check
  if (def?.plausibleBounds) {
    const { min, max } = def.plausibleBounds;
    if ((min !== undefined && rawValue < min) || (max !== undefined && rawValue > max)) {
      return {
        passed: false,
        actionTaken: 'flagged',
        originalValue: rawValue,
        originalUnit: parsedUnit,
        calibratedValue: rawValue,
        calibratedUnit: parsedUnit || def?.unit || '',
        warning: `Value ${rawValue} for ${def.name} falls outside physiological plausibility range (${min ?? 0} - ${max ?? 'inf'}).`,
      };
    }
  }

  return defaultPass;
}

/**
 * Generates a deterministic composite uniqueness hash to prevent duplicate writes
 * for the same patient specimen collection.
 */
export function generateBiomarkerRecordKey(
  userId: string,
  biomarkerKey: string,
  specimenCollectedDate: string,
  sourceFileHash?: string
): string {
  const u = (userId || 'user_default').trim();
  const k = (biomarkerKey || '').toLowerCase().trim();
  const d = (specimenCollectedDate || '').trim();
  const h = (sourceFileHash || 'direct').trim();
  return `rec_${u}_${k}_${d}_${h}`;
}
