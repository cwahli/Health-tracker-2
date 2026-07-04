const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf-8');
code = code.replace(/  quantity: string;\n/, "  quantity: string;\n  consumedAmount?: number;\n");
fs.writeFileSync('src/types.ts', code);
