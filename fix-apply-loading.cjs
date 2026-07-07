const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  "const handleApplyConsolidation = async () => {\n    if (!consolidationGroups || !onCombineBiomarkers) return;\n    try {",
  "const handleApplyConsolidation = async () => {\n    if (!consolidationGroups || !onCombineBiomarkers) return;\n    setConsolidationLoading(true);\n    try {"
);

code = code.replace(
  "alert(\"Error applying name consolidation: \" + e.message);\n    }",
  "alert(\"Error applying name consolidation: \" + e.message);\n    } finally {\n      setConsolidationLoading(false);\n    }"
);

code = code.replace(
  "onClick={handleApplyConsolidation}\n                    className=\"px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-1 transition-all\"",
  "onClick={handleApplyConsolidation}\n                    disabled={consolidationLoading}\n                    className=\"px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-1 transition-all disabled:opacity-50\""
);

code = code.replace(
  "<Save className=\"w-3.5 h-3.5\" />\n                    Approve & Apply",
  "{consolidationLoading ? <div className=\"w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin\" /> : <Save className=\"w-3.5 h-3.5\" />}\n                    {consolidationLoading ? 'Applying...' : 'Approve & Apply'}"
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log('Fixed apply loading');
