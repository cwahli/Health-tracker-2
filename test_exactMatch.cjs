const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

const matches = [...code.matchAll(/exactMatch =/g)];
console.log(`Found ${matches.length} exactMatch occurrences.`);
