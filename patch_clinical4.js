const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  '          }\n        }\n        } else if (n.includes("soup")',
  '          }\n        } else if (n.includes("soup")'
);

fs.writeFileSync('server.ts', code);
console.log("Fixed syntax error 4.");
