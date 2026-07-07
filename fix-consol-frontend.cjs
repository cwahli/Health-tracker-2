const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const parseFuncRegex = /  \/\/ Automated Name Consolidation YAML Parser\n  const parseConsolidationYaml = \(yamlText: string\): any\[\] => \{[\s\S]*?    return groups;\n  \};\n/g;

code = code.replace(parseFuncRegex, '');

const handleRunRegex = /      setConsolidationYaml\(data\.yamlText\);\n      const parsed = parseConsolidationYaml\(data\.yamlText \|\| ''\);\n      setConsolidationGroups\(parsed\);\n\n      const initialEdits: any = \{\};\n      parsed\.forEach\(\(group: any, idx: number\) => \{/g;

const newHandleRun = `      setConsolidationYaml(JSON.stringify(data.groups, null, 2));
      const parsed = data.groups || [];
      setConsolidationGroups(parsed);

      const initialEdits: any = {};
      parsed.forEach((group: any, idx: number) => {`;

code = code.replace(handleRunRegex, newHandleRun);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
