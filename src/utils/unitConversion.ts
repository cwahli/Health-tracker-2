export const CONVERSION_FACTORS: Record<string, { multiplier: number, from: string, to: string }> = {
  'hba1c': { multiplier: 1.0000, from: '%', to: '%' },
  'creatinine': { multiplier: 88.4956, from: 'mg/dL', to: 'umol/L' },
  'total_cholesterol': { multiplier: 0.0259, from: 'mg/dL', to: 'mmol/L' },
  'ldl': { multiplier: 0.0259, from: 'mg/dL', to: 'mmol/L' },
  'hdl': { multiplier: 0.0259, from: 'mg/dL', to: 'mmol/L' },
  'triglycerides': { multiplier: 0.0113, from: 'mg/dL', to: 'mmol/L' },
  'fasting_glucose': { multiplier: 0.0555, from: 'mg/dL', to: 'mmol/L' },
  'glucose': { multiplier: 0.0555, from: 'mg/dL', to: 'mmol/L' },
  'blood_urea_nitrogen': { multiplier: 0.3570, from: 'mg/dL', to: 'mmol/L' },
  'urea': { multiplier: 0.3570, from: 'mg/dL', to: 'mmol/L' },
  'uric_acid': { multiplier: 59.5238, from: 'mg/dL', to: 'umol/L' },
  'bilirubin': { multiplier: 17.0940, from: 'mg/dL', to: 'umol/L' },
  'calcium': { multiplier: 0.2500, from: 'mg/dL', to: 'mmol/L' },
  'phosphorus': { multiplier: 0.3230, from: 'mg/dL', to: 'mmol/L' },
  'magnesium': { multiplier: 0.4110, from: 'mg/dL', to: 'mmol/L' },
  'iron': { multiplier: 0.1790, from: 'ug/dL', to: 'umol/L' },
  'hemoglobin': { multiplier: 10.0000, from: 'g/dL', to: 'g/L' },
  'albumin': { multiplier: 10.0000, from: 'g/dL', to: 'g/L' },
  'total_protein': { multiplier: 10.0000, from: 'g/dL', to: 'g/L' },
  'thyroxine': { multiplier: 12.8700, from: 'ug/dL', to: 'nmol/L' },
  'vitamin_d': { multiplier: 2.4963, from: 'ng/mL', to: 'nmol/L' },
  'vitamin_b12': { multiplier: 0.7380, from: 'pg/mL', to: 'pmol/L' },
  'folate': { multiplier: 2.2660, from: 'ng/mL', to: 'nmol/L' },
  'testosterone': { multiplier: 0.0347, from: 'ng/dL', to: 'nmol/L' },
  'estradiol': { multiplier: 3.6711, from: 'pg/mL', to: 'pmol/L' },
  'progesterone': { multiplier: 3.1797, from: 'ng/mL', to: 'nmol/L' },
  'cortisol': { multiplier: 27.6243, from: 'ug/dL', to: 'nmol/L' },
};

export function standardizeUnit(key: string, value: number | string, currentUnit: string): { newValue: number | string, newUnit: string } {
  if (typeof value !== 'number' && isNaN(Number(value))) {
    return { newValue: value, newUnit: currentUnit };
  }

  const numericValue = Number(value);
  const conversion = CONVERSION_FACTORS[key.toLowerCase()];

  if (conversion && currentUnit.toLowerCase().trim() === conversion.from.toLowerCase()) {
    return {
      newValue: Number((numericValue * conversion.multiplier).toFixed(2)),
      newUnit: conversion.to
    };
  }

  return { newValue: value, newUnit: currentUnit };
}

export function reverseStandardizeUnit(key: string, value: number | string, currentUnit: string): { newValue: number | string, newUnit: string } {
  if (typeof value !== 'number' && isNaN(Number(value))) {
    return { newValue: value, newUnit: currentUnit };
  }

  const numericValue = Number(value);
  const conversion = CONVERSION_FACTORS[key.toLowerCase()];

  if (conversion && currentUnit.toLowerCase().trim() === conversion.to.toLowerCase()) {
    return {
      newValue: Number((numericValue / conversion.multiplier).toFixed(2)),
      newUnit: conversion.from
    };
  }

  return { newValue: value, newUnit: currentUnit };
}

export function formatBiomarkerDisplay(key: string, value: number | string, currentUnit: string, preference?: 'SI' | 'US'): { value: number | string, unit: string } {
  if (preference === 'US') {
    const reversed = reverseStandardizeUnit(key, value, currentUnit);
    return { value: reversed.newValue, unit: reversed.newUnit || currentUnit };
  }
  return { value, unit: currentUnit };
}

export function formatNormalRange(key: string, normalRange: string, currentUnit: string, preference?: 'SI' | 'US'): string {
  if (preference !== 'US') return normalRange;
  
  // Replace any numbers in the string with their converted values
  return normalRange.replace(/[\d\.]+/g, (match) => {
    const reversed = reverseStandardizeUnit(key, match, currentUnit);
    return String(reversed.newValue);
  });
}
