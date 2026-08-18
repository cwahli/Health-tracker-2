import { normalizeStemKey, lookupClinicalSynonym } from './src/utils/biomarkers.ts';
const input = 'body_mass_index_kg_m2';
const cleanNoUnderscore = input.toLowerCase().replace(/[^a-z0-9]/g, '');
const directSyn = lookupClinicalSynonym(cleanNoUnderscore);
const stem = normalizeStemKey(input);
const stemSyn = lookupClinicalSynonym(stem);
console.log("cleanNoUnderscore:", cleanNoUnderscore, "directSyn:", directSyn);
console.log("stem:", stem, "stemSyn:", stemSyn);
