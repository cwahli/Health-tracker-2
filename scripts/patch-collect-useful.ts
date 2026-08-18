import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /if \(val !== undefined && val !== null && val !== '' && !Number\.isNaN\(val\)\) \{/g,
  "if (isUsefulBiomarkerValue(val)) {"
);

fs.writeFileSync(path, code);
