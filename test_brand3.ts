import { isGenericCommodityFood, isKnownDatabaseBrandSync } from './serverBrandMenu.js';
const query = 'Mr Oat Rolled Oats';
console.log('isGeneric:', isGenericCommodityFood(query));
console.log('isDbBrand:', isKnownDatabaseBrandSync(query));
