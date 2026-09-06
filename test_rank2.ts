import { scoreCandidate } from './server_fdc_resolve.ts';

const usda = [
  { description: 'Donut' },
  { description: 'Donut, cake' },
  { description: 'Donut, yeast' },
  { description: 'Coconut milk' },
  { description: 'Coconut milk, raw' }
];

console.log('donut vs Donut:', scoreCandidate('donut', usda[0]));
console.log('donut vs Donut, cake:', scoreCandidate('donut', usda[1]));
console.log('coconut milk vs Coconut milk:', scoreCandidate('coconut milk', usda[3]));
console.log('coconut milk vs Coconut milk, raw:', scoreCandidate('coconut milk', usda[4]));
