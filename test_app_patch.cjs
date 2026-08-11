const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetMedical = `          if (job.kind === 'medical') {`;
console.log(code.includes(targetMedical));
