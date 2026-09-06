import { pickQueryScopedMatch } from './server_query_scoped_match.ts';
const dbMatches = [
  { id: '123', source: 'internal_catalog', searchQuery: 'donut malaysia matcha', name: 'donut malaysia matcha' }
];
console.log(pickQueryScopedMatch('donut malaysia matcha', dbMatches, [], new Set()));
