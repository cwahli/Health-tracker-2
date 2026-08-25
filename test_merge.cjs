const tsConfig = require('./tsconfig.json');
require('ts-node').register(tsConfig);
const { getMergedBiomarkerDef } = require('./src/utils/biomarkers.ts');
console.log(getMergedBiomarkerDef('fasting_glucose', undefined, { category: 'other' }));
