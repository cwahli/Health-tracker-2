import { fetchAllDatabaseBrands, isKnownDatabaseBrandSync } from './serverBrandMenu.js';
(async () => {
  await fetchAllDatabaseBrands();
  console.log('isDbBrand:', isKnownDatabaseBrandSync('Mr Oat Rolled Oats'));
  console.log('isDbBrand:', isKnownDatabaseBrandSync('mr oat'));
})();
