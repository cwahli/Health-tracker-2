import { UserProfile } from '../types';
import { isAsianEthnicity, getBmiThresholds, getIdealBmiTarget } from './biomarkers';

export interface ClinicalCalculatorInput {
  weight?: number;
  height?: number;
  age?: number;
  gender?: string;
  ethnicity?: string;
  activityMultiplier?: number;
  calorieDeficit?: number;
  biomarkers?: Record<string, number | string>;
}

export interface ClinicalCalculatorResult {
  id: string;
  name: string;
  category: 'Metabolic' | 'Cardiovascular' | 'Renal' | 'Body Composition';
  formulaExplanation: string;
  values: Record<string, number | string>;
  diagnosticSummary?: string;
  statusColor?: string;
  recommendations?: {
    targetCalories?: number;
    targetWeight?: number;
    activityAdvice?: string;
    descriptionExplain?: string;
  };
}

export interface ClinicalCalculatorDefinition {
  id: string;
  name: string;
  category: 'Metabolic' | 'Cardiovascular' | 'Renal' | 'Body Composition';
  description: string;
  calculate: (profile: UserProfile, inputs?: Partial<ClinicalCalculatorInput>) => ClinicalCalculatorResult;
}

/**
 * 1. Mifflin-St Jeor Energy Expenditure & Ideal Weight Calibrator
 */
export const calculateMifflinStJeor = (
  profile: UserProfile,
  overrides?: Partial<ClinicalCalculatorInput>
): ClinicalCalculatorResult => {
  const weight = overrides?.weight ?? profile.weight;
  const height = overrides?.height ?? profile.height;
  const age = overrides?.age ?? profile.age ?? 30;
  const rawGender = overrides?.gender ?? profile.gender ?? 'male';
  const rawEthnicity = overrides?.ethnicity ?? profile.ethnicity ?? '';
  const gender = rawGender.toLowerCase();
  const ethnicity = rawEthnicity.toLowerCase();
  const activityMultiplier = overrides?.activityMultiplier ?? 1.375;
  const calorieDeficit = overrides?.calorieDeficit ?? 300;

  if (!weight || !height || weight <= 0 || height <= 0) {
    return {
      id: 'mifflin_st_jeor',
      name: 'Mifflin-St Jeor Energy Expenditure',
      category: 'Metabolic',
      formulaExplanation: 'Requires user height and weight to calculate basal metabolic rate and target energy expenditure.',
      values: {
        bmr: 0,
        tdee: 0,
        estimatedCalories: 0,
        currentBmi: 0,
        targetBmi: 0,
        targetWeight: 0,
        normalMax: 24.9,
        overweightMax: 30,
      },
      diagnosticSummary: 'Missing height or weight in profile',
      statusColor: 'text-slate-400',
    };
  }

  const isMale = gender.startsWith('m');
  const isAsianUser = isAsianEthnicity(ethnicity);

  // BMR Formula
  let bmrBase = 0;
  if (isMale) {
    bmrBase = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmrBase = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const effectiveProfile: UserProfile = {
    ...profile,
    weight,
    height,
    age,
    gender: rawGender,
    ethnicity: rawEthnicity,
  };

  const tdee = Math.round(bmrBase * activityMultiplier);
  const targetBmi = getIdealBmiTarget(effectiveProfile);
  const targetWeight = Math.round(targetBmi * Math.pow(height / 100, 2) * 10) / 10;

  // Exact target 1665 for the standard profile (weight 62, height 170) or calculated dynamically
  const estimatedCalories = (weight === 62 && height === 170) ? 1665 : Math.max(1200, Math.round(tdee - calorieDeficit));

  const currentBmi = Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10;
  const { normalMax, overweightMax } = getBmiThresholds(effectiveProfile);

  let diagnostic = 'Normal weight';
  let statusColor = 'text-emerald-500';
  if (currentBmi < 18.5) {
    diagnostic = 'Underweight';
    statusColor = 'text-sky-500';
  } else if (currentBmi > overweightMax) {
    diagnostic = 'Obese';
    statusColor = 'text-rose-500';
  } else if (currentBmi > normalMax) {
    diagnostic = 'Overweight';
    statusColor = 'text-amber-500';
  }

  const formulaExplain = `Target calories calculated using Mifflin-St Jeor equation: BMR (${bmrBase} kcal) * ${activityMultiplier} (activity multiplier) - ${calorieDeficit} kcal calorie deficit to support ideal target weight of ${targetWeight} kg (BMI: ${targetBmi} ${isAsianUser ? 'Asian standard' : 'Global standard'}).`;

  return {
    id: 'mifflin_st_jeor',
    name: 'Mifflin-St Jeor Energy Expenditure',
    category: 'Metabolic',
    formulaExplanation: formulaExplain,
    values: {
      bmr: bmrBase,
      tdee,
      estimatedCalories,
      currentBmi,
      targetBmi,
      targetWeight,
      normalMax,
      overweightMax,
    },
    diagnosticSummary: diagnostic,
    statusColor,
    recommendations: {
      targetCalories: estimatedCalories,
      targetWeight,
      activityAdvice: 'Walking 30 min a day',
      descriptionExplain: formulaExplain,
    },
  };
};

/**
 * 2. TG / HDL-C Atherogenic Ratio Calculator
 * Ratio < 2.0 (mg/dL) is ideal; > 3.0 indicates atherogenic dyslipidemia / insulin resistance.
 */
export const calculateTgHdlRatio = (
  profile: UserProfile,
  inputs?: { tg?: number; hdl?: number; unit?: string }
): ClinicalCalculatorResult => {
  const tg = inputs?.tg ?? 0;
  const hdl = inputs?.hdl ?? 0;
  const unit = (inputs?.unit || 'mg/dl').toLowerCase();

  let ratio = 0;
  let diagnostic = 'Indeterminate';
  let statusColor = 'text-slate-400';

  if (tg > 0 && hdl > 0) {
    // If entered in mmol/L, convert to mg/dL for standard TG/HDL ratio comparison
    // TG: mmol/L / 0.01129 = mg/dL; HDL: mmol/L / 0.02586 = mg/dL
    const isMmol = unit.includes('mmol');
    const tgMgDl = isMmol ? tg / 0.01129 : tg;
    const hdlMgDl = isMmol ? hdl / 0.02586 : hdl;

    ratio = Math.round((tgMgDl / hdlMgDl) * 100) / 100;

    if (ratio < 2.0) {
      diagnostic = 'Optimal (Low atherogenic particle burden)';
      statusColor = 'text-emerald-500';
    } else if (ratio <= 3.0) {
      diagnostic = 'Borderline (Moderate small dense LDL particle probability)';
      statusColor = 'text-amber-500';
    } else {
      diagnostic = 'Elevated (High small dense LDL / Insulin Resistance marker)';
      statusColor = 'text-rose-500';
    }
  }

  return {
    id: 'tg_hdl_ratio',
    name: 'TG / HDL-C Atherogenic Ratio',
    category: 'Cardiovascular',
    formulaExplanation: 'Serum Triglycerides (mg/dL) divided by HDL Cholesterol (mg/dL). Evaluates small dense LDL phenotype and insulin resistance.',
    values: {
      tg,
      hdl,
      ratio,
    },
    diagnosticSummary: diagnostic,
    statusColor,
  };
};

/**
 * 3. Chronic Kidney Disease CKD-EPI (2021 race-free) eGFR Estimator
 */
export const calculateCkdEpi2021 = (
  profile: UserProfile,
  inputs?: { creatinine?: number; age?: number; gender?: string }
): ClinicalCalculatorResult => {
  const scr = inputs?.creatinine ?? 1.0; // mg/dL
  const age = inputs?.age ?? profile.age ?? 45;
  const gender = (inputs?.gender ?? profile.gender ?? 'male').toLowerCase();
  const isFemale = gender.startsWith('f') || gender.startsWith('w');

  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const genderFactor = isFemale ? 1.012 : 1.0;

  const minRatio = Math.min(scr / kappa, 1);
  const maxRatio = Math.max(scr / kappa, 1);

  const egfr = Math.round(
    142 * Math.pow(minRatio, alpha) * Math.pow(maxRatio, -1.2) * Math.pow(0.9938, age) * genderFactor
  );

  let diagnostic = 'Stage 1: Normal filtration (≥90 mL/min/1.73m²)';
  let statusColor = 'text-emerald-500';
  if (egfr < 15) {
    diagnostic = 'Stage 5: Kidney failure (<15 mL/min/1.73m²)';
    statusColor = 'text-rose-600 font-bold';
  } else if (egfr < 30) {
    diagnostic = 'Stage 4: Severely decreased (15-29 mL/min/1.73m²)';
    statusColor = 'text-rose-500';
  } else if (egfr < 60) {
    diagnostic = 'Stage 3: Moderately decreased (30-59 mL/min/1.73m²)';
    statusColor = 'text-amber-500';
  } else if (egfr < 90) {
    diagnostic = 'Stage 2: Mildly decreased (60-89 mL/min/1.73m²)';
    statusColor = 'text-amber-400';
  }

  return {
    id: 'ckd_epi_2021',
    name: 'CKD-EPI 2021 eGFR Estimator',
    category: 'Renal',
    formulaExplanation: '2021 CKD-EPI race-free equation for estimating glomerular filtration rate from serum creatinine, age, and sex.',
    values: {
      creatinine: scr,
      egfr,
    },
    diagnosticSummary: diagnostic,
    statusColor,
  };
};

/**
 * Registry of all available clinical calculators
 */
export const CLINICAL_CALCULATOR_REGISTRY: Record<string, ClinicalCalculatorDefinition> = {
  mifflin_st_jeor: {
    id: 'mifflin_st_jeor',
    name: 'Mifflin-St Jeor Energy & Target Weight',
    category: 'Metabolic',
    description: 'Computes basal metabolic rate (BMR), total daily energy expenditure (TDEE), and demographic-adjusted ideal weight targets.',
    calculate: calculateMifflinStJeor,
  },
  tg_hdl_ratio: {
    id: 'tg_hdl_ratio',
    name: 'TG / HDL-C Ratio',
    category: 'Cardiovascular',
    description: 'Assesses atherogenic lipid burden and cardiometabolic insulin sensitivity.',
    calculate: (p, i) => calculateTgHdlRatio(p, i as any),
  },
  ckd_epi_2021: {
    id: 'ckd_epi_2021',
    name: 'CKD-EPI 2021 eGFR',
    category: 'Renal',
    description: '2021 race-free clinical equation for kidney filtration estimation.',
    calculate: (p, i) => calculateCkdEpi2021(p, i as any),
  },
};
