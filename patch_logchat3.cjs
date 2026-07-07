const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetProps = `  actions?: any[];`;
const replacementProps = `  actions?: any[];
  googleSteps?: number | null;`;
code = code.replace(targetProps, replacementProps);

const targetDestruct = `  actions = [],`;
const replacementDestruct = `  actions = [],
  googleSteps = null,`;
code = code.replace(targetDestruct, replacementDestruct);

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched LogChat extra props");
