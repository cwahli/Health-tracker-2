import { calculateTokenOverlap, hasCoreTokenOverlap } from './server_food_resolver_curator.ts';
console.log(calculateTokenOverlap('soybean oil', 'Oil, vegetable, soybean, refined'));
console.log(hasCoreTokenOverlap('soybean oil', 'Oil, vegetable, soybean, refined'));
