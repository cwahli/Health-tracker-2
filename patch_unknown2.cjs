const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(/{src !== tgt && \(/g, '{src !== tgtKey && (');
code = code.replace(/title={tgt}>{tgt}/g, 'title={tgtKey}>{tgtKey}');

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched unknown type 2");
