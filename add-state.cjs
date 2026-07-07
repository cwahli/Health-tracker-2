const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regexStates = /  const \[isNameConsolidationMode, setIsNameConsolidationMode\] = useState<boolean>\(false\);\n  const \[nameConsolidationModel, setNameConsolidationModel\] = useState<string>\('gemini-3.1-flash-lite'\);\n  const \[consolidationYaml, setConsolidationYaml\] = useState<string \| null>\(null\);\n  const \[consolidationGroups, setConsolidationGroups\] = useState<any\[\] \| null>\(null\);\n  const \[consolidationLoading, setConsolidationLoading\] = useState<boolean>\(false\);/;

code = code.replace(regexStates, `  const [isNameConsolidationMode, setIsNameConsolidationMode] = useState<boolean>(false);
  const [nameConsolidationModel, setNameConsolidationModel] = useState<string>('gemini-3.1-flash-lite');
  const [consolidationYaml, setConsolidationYaml] = useState<string | null>(null);
  const [consolidationGroups, setConsolidationGroups] = useState<any[] | null>(null);
  const [consolidationLoading, setConsolidationLoading] = useState<boolean>(false);
  const [consolidationInput, setConsolidationInput] = useState<string>('');
  const [consolidationMessages, setConsolidationMessages] = useState<any[]>([]);`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
