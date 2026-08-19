import { rankAndClassifyCandidates } from './server_fdc_resolve.js';
console.log(rankAndClassifyCandidates('pink sugar icing', [
  { fdcId: '169652', description: 'Sugars, granulated' },
  { fdcId: '1100123', description: 'Pink icing doughnut' },
]));
