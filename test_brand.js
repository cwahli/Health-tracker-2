import { searchBrandMenuItems } from './dist/serverBrandMenu.js';
(async () => {
  console.log(await searchBrandMenuItems("oat rolled"));
})();
