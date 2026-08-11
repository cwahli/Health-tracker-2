const fs = require('fs');
let code = fs.readFileSync('serverJobs.ts', 'utf8');

const target1 = `  const dbKind = kind || 'food_log';
  const dbMode = mode || 'review';
  let initialStatusMessage = 'Starting cloud food analysis...';`;

const replacement1 = `  const dbKind = kind || 'food_log';
  const dbMode = mode || 'review';
  let initialStatusMessage = dbKind === 'medical' ? 'Starting medical analysis...' : 'Starting cloud food analysis...';`;

const target2 = `      let response: Response;
      try {
        response = await fetch(\`\${baseUrl}/api/gemini/food-analyze?stream=true\`, {`;

const replacement2 = `      let response: Response;
      const endpoint = dbKind === 'medical' ? '/api/gemini/medical-analyze?stream=true' : '/api/gemini/food-analyze?stream=true';
      try {
        response = await fetch(\`\${baseUrl}\${endpoint}\`, {`;

const target3 = `          response = await fetch(\`http://localhost:\${port}/api/gemini/food-analyze?stream=true\`, {`;
const replacement3 = `          response = await fetch(\`http://localhost:\${port}\${endpoint}\`, {`;

code = code.replace(target1, replacement1);
code = code.replace(target2, replacement2);
code = code.replace(target3, replacement3);

fs.writeFileSync('serverJobs.ts', code);
console.log('Patched serverJobs.ts');
