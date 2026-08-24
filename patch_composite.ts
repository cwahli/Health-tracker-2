import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

code = code.replace(
  /\|compounds\?\|sets\?\|surimi\)\\b\/i\.test\(/,
  '|compounds?|sets?|surimi|with|and)\\b/i.test('
);

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Patched composite check.");
