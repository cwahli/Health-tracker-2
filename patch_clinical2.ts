import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /potassium: 200, totalFibre: 3, solubleFibre: 0\.5 \};\n        return \{ \.\.\.base, \.\.\.overrides \};\n      \};/g,
  'potassium: 200, totalFibre: 3, solubleFibre: 0.5 };\n        }\n        return { ...base, ...overrides };\n      };'
);

fs.writeFileSync('server.ts', code);
console.log("Fixed syntax error.");
