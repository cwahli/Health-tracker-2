const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

code = code.split('const isNew = row.noChangeNeeded ? false : (existingEntries.length === 0);').join('let isNew = row.noChangeNeeded ? false : (existingEntries.length === 0);');

fs.writeFileSync('src/components/AgentResultTable.tsx', code);
console.log("Updated isNew to let");
