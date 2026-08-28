const fs = require('fs');
let code = fs.readFileSync('serverBrandMenu.ts', 'utf8');

const regex = /  const formatBrandHit = ([\s\S]*?)export async function searchBrandMenuItems\(query: string, explicitChainKey\?: string\): Promise<any\[\]> {\n  \/\/ Guard: generic commodity foods without explicit brand in query should never match branded menu items/m;
const match = code.match(regex);
if (match) {
  const extracted = match[1];
  code = code.replace(match[0], ''); // remove it from inside
  const searchStart = code.indexOf('export async function searchBrandMenuItems');
  code = code.slice(0, searchStart) + extracted + '\n' + code.slice(searchStart);
  fs.writeFileSync('serverBrandMenu.ts', code, 'utf8');
  console.log("Patched successfully!");
} else {
  console.log("Could not find the chunk!");
}
