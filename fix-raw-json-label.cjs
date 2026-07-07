const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /<span className="flex items-center gap-1\.5"><FileCode className="w-3\.5 h-3\.5" \/> RAW YAML<\/span>/g;
code = code.replace(regex, `<span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> RAW JSON</span>`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
