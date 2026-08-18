import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "if (!isKeyNotUsed(k)) {",
  "if (!isKeyNotUsed(k) && !aliasKeysToHide.has(k)) {"
);

code = code.replace(
  "const totalUniqueCount = useMemo(() => {",
  "const totalUniqueCount = useMemo(() => {"
);

code = code.replace(
  "}, [historyKeys, customKeys, isKeyNotUsed]);",
  "}, [historyKeys, customKeys, isKeyNotUsed, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);
