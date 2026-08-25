const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerExpandedSection.tsx', 'utf8');

code = code.replace(
  '<div className="flex flex-wrap gap-1.5 px-1 py-0.5">',
  '<div className="flex flex-wrap gap-1.5 px-1 py-0.5 mt-2">'
);

fs.writeFileSync('src/components/BiomarkerExpandedSection.tsx', code);
