import { searchBrandMenuItems } from './serverBrandMenu';

async function run() {
  const results = await searchBrandMenuItems("potato raw");
  console.log(JSON.stringify(results, null, 2));
}
run();
