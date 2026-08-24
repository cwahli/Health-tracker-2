import fs from 'fs';
const text = fs.readFileSync('server.ts', 'utf8');

// Find getClinicalDefaultNutrients100g inside callAndParseFoodAnalysis
const defStart = text.indexOf('const getClinicalDefaultNutrients100g = ');
// Move it up outside the function! Wait, that's brittle.
