const fs = require('fs');
let code = fs.readFileSync('src/components/AllAnalysesModal.tsx', 'utf8');
code = code.replace(/const \[jobToDelete, setJobToDelete\] = useState<string \| null>\(null\);\s*/, '');
// Remove the portal for the delete modal if it exists
code = code.replace(/\{jobToDelete && \([\s\S]*?\}\s*<\/div>\s*,\s*document\.body\s*\)\}/, '');
fs.writeFileSync('src/components/AllAnalysesModal.tsx', code);
