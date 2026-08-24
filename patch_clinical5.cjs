const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /        \}\n\s*\} else if \(n\.includes\("soup"\)/g,
  '        } else if (n.includes("soup")'
);

fs.writeFileSync('server.ts', code);
console.log("Fixed syntax error 5.");
