import { getMappedBiomarkerKey } from './src/utils/biomarkers.ts';
console.log("bmi", getMappedBiomarkerKey("bmi"));
console.log("Body Mass Index", getMappedBiomarkerKey("Body Mass Index"));
console.log("body_mass_index_kg_m2", getMappedBiomarkerKey("body_mass_index_kg_m2"));
console.log("BMI (kg/m2)", getMappedBiomarkerKey("BMI (kg/m2)"));
