const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const searchBlock = `    if (!q) return true;
    if (!def) return k.toLowerCase().includes(q);
    return k.toLowerCase().includes(q) || (def.name || '').toLowerCase().includes(q);
  };`;

const searchRepl = `    if (!q) return true;
    if (!def) return k.toLowerCase().includes(q);
    const meta = getBiomarkerMetadata(k, def);
    const hasTagMatch = meta.standardMedicalGrouping?.toLowerCase().includes(q) ||
        meta.riskCategories?.some((r: string) => r.toLowerCase().includes(q)) ||
        meta.potentialMedicalConditions?.some((c: string) => c.toLowerCase().includes(q)) ||
        def?.category?.toLowerCase().includes(q);
    return k.toLowerCase().includes(q) || (def.name || '').toLowerCase().includes(q) || hasTagMatch;
  };`;

code = code.replace(searchBlock, searchRepl);

// Also add onTagClick to "Medical Practice" tag
const medPracBlock = `                  {initialGrouping && (
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <span className="text-[8px] uppercase tracking-wider opacity-70">Medical Practice:</span>
                      {initialGrouping}
                    </span>
                  )}`;

const medPracRepl = `                  {initialGrouping && (
                    <span 
                      onClick={() => onTagClick && onTagClick(initialGrouping.trim())}
                      className={\`text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1 \${onTagClick ? 'cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700' : ''}\`}
                    >
                      <span className="text-[8px] uppercase tracking-wider opacity-70">Medical Practice:</span>
                      {initialGrouping}
                    </span>
                  )}`;

code = code.replace(medPracBlock, medPracRepl);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
