const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(/\[item\.key\]:/g, "[item.id]:");
code = code.replace(/prev\[item\.key\]/g, "prev[item.id]");
code = code.replace(/key=\{item\.key\}/g, "key={item.id}");

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
