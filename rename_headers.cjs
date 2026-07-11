const fs = require('fs');

let modalContent = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');
modalContent = modalContent.replace('<th className="p-3">Proposed Grouping</th>', '<th className="p-3">Medical Practice</th>');
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', modalContent);

let tableContent = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');
tableContent = tableContent.replace("tableHeader('Medical Grouping', 'group')", "tableHeader('Medical Practice', 'group')");
fs.writeFileSync('src/components/AgentResultTable.tsx', tableContent);
