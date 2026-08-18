import { isBiomarkerDuplicateCandidate } from '../src/utils/biomarkers';

const b1 = { key: 'egfr', name: 'eGFR', unit: 'mL/min/1.73m2', normalRange: '> 60' };
const b2 = { key: 'egfr_non_afr_am_ml_min_1_73m2', name: 'eGFR Non-Afr. Am.', unit: 'mL/min/1.73m2', normalRange: '> 60' };
const b3 = { key: 'egfr_ml_min_1_73m2', name: 'eGFR', unit: 'mL/min/1.73m2', normalRange: '> 60' };

console.log(isBiomarkerDuplicateCandidate(b1, b2));
console.log(isBiomarkerDuplicateCandidate(b1, b3));
