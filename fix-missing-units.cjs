const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex1 = /const allApprovedKeys = useMemo\(\(\) => \{/;
const newCode1 = `const missingUnitsCount = useMemo(() => {
    let count = 0;
    const allKnown = new Set([...historyKeys, ...customKeys, ...allApprovedKeysUnfiltered]);
    allKnown.forEach(k => {
      const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((d: any) => d.key === k);
      const unit = def?.unit || '';
      if (!unit || unit.trim() === '') count++;
    });
    return count;
  }, [historyKeys, customKeys, allApprovedKeysUnfiltered, profile.customBiomarkers]);

  const allApprovedKeys = useMemo(() => {`;

if (code.match(regex1)) {
  code = code.replace(regex1, newCode1);
} else {
  console.log('regex1 failed');
}

const regex2 = /<button\s*onClick=\{\(\) => setShowOnlyMissingUnits\(prev => !prev\)\}\s*className=\{`px-3 py-1\.5 border rounded-lg text-xs font-bold transition-all flex items-center gap-1 \$\{\s*showOnlyMissingUnits\s*\?\s*'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950\/20 dark:text-rose-400 dark:border-rose-900\/30 font-extrabold ring-1 ring-rose-500\/20'\s*:\s*'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'\s*\}\`\}\s*>\s*<AlertCircle className="w-3\.5 h-3\.5 text-rose-500 shrink-0" \/>\s*Missing Units Only\s*<\/button>/;

const newCode2 = `{(missingUnitsCount > 0 || showOnlyMissingUnits) && (
                  <button
                    onClick={() => setShowOnlyMissingUnits(prev => !prev)}
                    className={\`px-3 py-1.5 border rounded-lg text-xs font-bold transition-all flex items-center gap-1 \${
                      showOnlyMissingUnits 
                        ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30 font-extrabold ring-1 ring-rose-500/20' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }\`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Missing Units Only ({missingUnitsCount})
                  </button>
                )}`;

if (code.match(regex2)) {
  code = code.replace(regex2, newCode2);
} else {
  console.log('regex2 failed');
}

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log('Fixed missing units');
