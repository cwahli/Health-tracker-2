import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /if \(parsedData\.nutrients && parsedData\.itemsBreakdown && parsedData\.itemsBreakdown\.length === 1 && \(userSelectedMode/g,
  'if (parsedData.nutrients && parsedData.itemsBreakdown && (userSelectedMode'
);

fs.writeFileSync('server.ts', code);
console.log("Patched itemsBreakdown length guard in server.ts");
