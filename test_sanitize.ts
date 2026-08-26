import { purgeHallucinatedAndCorruptedData } from './src/utils/dataSanitize.js';

const log1 = {
  date: '2026-06-05',
  biomarkers: {
    'total_cholesterol': 6.1,
    'triglycerides': 1.07,
    'non_hdl_cholesterol': 4.7,
    'ldl': 4.2,
    'cholesterol_hdl_ratio': 4.3,
    'alt': 41,
    'ast': 27,
    'bmi': 23.3,
    'mpv': 10.6,
    'rbc': 5.47,
    'rdw': 11.8,
    'wbc': 5.7,
    'egfr': 80,
    'hba1c': 40,
    'height': 163,
    'qrisk2': 1.2,
    'weight': 62,
    'platelets': 227,
    'creatinine': 100,
    'hematocrit': 48,
    'serum_sodium': 143,
    'albumin': 46,
    'calcium': 2.47,
    'total_protein': 81,
    'globulin': 35,
    'potassium': 4.3,
    'bilirubin': 16,
    'lymphocytes': 1.97,
    'neutrophils': 3.18,
    'audit_c_total_score': 3,
    'alp': 39,
    'adjusted_calcium': 2.37,
    'mcv': 88,
    'psa': 1.41,
    'phosphate': 1.12,
    'mch': 30.3,
    'pdw': 12.9,
    'nucleated_rbc': 0,
  }
};

const res = purgeHallucinatedAndCorruptedData([log1], null);
console.log(JSON.stringify(res.biomarkerHistory.find(l => l.date === '2026-06-05'), null, 2));
