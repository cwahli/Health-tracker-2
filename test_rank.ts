import { rankAndClassifyCandidates } from './server_fdc_resolve.ts';
const usda = [
  { fdcId: '1', description: 'Donut' },
  { fdcId: '2', description: 'Donut, cake' },
];
console.log('donut:', rankAndClassifyCandidates('donut', usda, 85));
const usda2 = [
  { fdcId: '1', description: 'Tomato' },
  { fdcId: '2', description: 'Tomatoes' },
];
console.log('tomato:', rankAndClassifyCandidates('tomato', usda2, 85));
const usda3 = [
  { fdcId: '1', description: 'Coconut milk' },
  { fdcId: '2', description: 'Coconut milk, raw' },
];
console.log('coconut milk:', rankAndClassifyCandidates('coconut milk', usda3, 85));
