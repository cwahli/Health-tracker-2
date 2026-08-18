import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "return allApprovedKeysUnfiltered.filter(filterFn);",
  "return allApprovedKeysUnfiltered.filter(filterFn).filter(k => !aliasKeysToHide.has(k));"
);

code = code.replace(
  "return Array.from(keys).filter(k => checkKeyNeedsApproval(k)).filter(filterFn);",
  "return Array.from(keys).filter(k => checkKeyNeedsApproval(k)).filter(filterFn).filter(k => !aliasKeysToHide.has(k));"
);

fs.writeFileSync(path, code);
