import { rankAndClassifyCandidates } from './dist/server.cjs';
const candidates = [{ fdcId: '123', description: 'Donut' }, { fdcId: '124', description: 'Donut, cake' }];
const res = rankAndClassifyCandidates('donut', candidates, 85);
console.log(res);
