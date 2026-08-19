import { scoreCandidate } from './server_fdc_resolve.js';
import { calculateGenericTokenCoverage } from './server_matching_engine.js';

console.log('Granola tokens:', calculateGenericTokenCoverage(['baked', 'granola'], ['cereals', 'readytoeat', 'granola', 'homemade']));
console.log('Berries tokens:', calculateGenericTokenCoverage(['mixed', 'berries'], ['blueberries', 'raw']));
console.log('Falafel tokens:', calculateGenericTokenCoverage(['cooked', 'falafel'], ['falafel', 'homemade']));
console.log('Mayo tokens:', calculateGenericTokenCoverage(['garlic', 'mayonnaise', 'dressing'], ['mayonnaise', 'regular']));
console.log('Chicken tokens:', calculateGenericTokenCoverage(['grilled', 'chicken', 'breast'], ['chicken', 'broilers', 'or', 'fryers', 'breast', 'meat', 'only', 'cooked', 'roasted']));
console.log('Egg tokens:', calculateGenericTokenCoverage(['hard', 'boiled', 'egg'], ['egg', 'whole', 'cooked', 'hardboiled']));

