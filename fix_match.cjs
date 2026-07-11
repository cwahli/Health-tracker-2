const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

const target = `const isValueMatch = (!isNaN(numMatchVal) && !isNaN(numRowVal) && numMatchVal === numRowVal) || String(matchVal) === String(row.value);`;
const replace = `const isValueMatch = (!isNaN(numMatchVal) && !isNaN(numRowVal) && numMatchVal === numRowVal) || String(matchVal).toLowerCase().trim() === String(row.value).toLowerCase().trim();`;

if(code.includes(target)) {
  code = code.split(target).join(replace);
  console.log("Updated isValueMatch");
} else {
  console.log("Could not find isValueMatch");
}

fs.writeFileSync('src/components/AgentResultTable.tsx', code);
