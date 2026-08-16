import { getMappedBiomarkerKey } from './src/utils/biomarkers';
console.log('albumin:', getMappedBiomarkerKey('albumin'));
console.log('urine albumin:', getMappedBiomarkerKey('urine albumin'));
console.log('haemoglobin:', getMappedBiomarkerKey('haemoglobin'));
console.log('mean_corpuscular_haemoglobin:', getMappedBiomarkerKey('mean_corpuscular_haemoglobin'));
