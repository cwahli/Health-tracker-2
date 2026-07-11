const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `      if (specificUpdate && specificUpdate.type !== 'multi' && specificUpdate.type !== 'fullPush') {`;
const replace = `      if (specificUpdate && specificUpdate.type !== 'fullPush') {`;

if (code.includes(target)) {
  code = code.split(target).join(replace);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Updated App.tsx successfully.");
} else {
  console.log("Targets not found in App.tsx!");
}
