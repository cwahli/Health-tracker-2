const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = 'Object.keys(biomarkerDefinitions).join(';
const replace = 'Array.from(new Set([...Object.keys(biomarkerDefinitions), ...Object.keys(userProfile?.customBiomarkers || {})])).join(';

if(code.includes(target)) {
  code = code.split(target).join(replace);
  console.log("Updated EXISTING DATABASE KEYS");
} else {
  console.log("Could not find target");
}

fs.writeFileSync('server.ts', code);
