const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetProps = `  report?: any;`;
const replacementProps = `  report?: any;
  actions?: any[];`;
code = code.replace(targetProps, replacementProps);

const targetDestruct = `  report,
  agentType = null,`;
const replacementDestruct = `  report,
  actions = [],
  agentType = null,`;
code = code.replace(targetDestruct, replacementDestruct);

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched LogChat actions props");
