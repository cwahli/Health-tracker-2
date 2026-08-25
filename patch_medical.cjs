const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

// Add getBiomarkerRangeSourceInfo to imports
if (!code.includes('getBiomarkerRangeSourceInfo')) {
  code = code.replace(
    /import \{ biomarkerDefinitions, getBiomarkerStatus/g,
    `import { getBiomarkerRangeSourceInfo } from '../utils/biomarkerLifecycle';\nimport { biomarkerDefinitions, getBiomarkerStatus`
  );
}
if (!code.includes('formatOptimalTargetValue')) {
    code = code.replace(
        /import \{ biomarkerDefinitions, getBiomarkerStatus/g,
        `import { formatOptimalTargetValue } from '../utils/agentCalibration';\nimport { biomarkerDefinitions, getBiomarkerStatus`
    );
}

// Add the download function near the top of the component
const funcString = `
  const exportBiomarkersToCSV = () => {
    const headers = [
      "Biomarker Name", 
      "Key",
      "Unit", 
      "Normal Range", 
      "Custom Range", 
      "Clinical Reference Range", 
      "Optimal Target Value", 
      "Risk Categories", 
      "Medical Insights (Potential Conditions)", 
      "Historical Logs (Date: Value)"
    ];

    const rows = filteredBiomarkers.map(def => {
      const customDef = getCustomBiomarkerDef(profile, def.key);
      const name = def.name || customDef?.name || def.key;
      const key = def.key;
      const unit = def.unit || customDef?.unit || '';
      
      const normalRange = def.normalRange || '';
      const customRange = customDef?.normalRange || '';
      
      const rangeSourceInfo = getBiomarkerRangeSourceInfo(key, def, profile);
      const clinicalReferenceRange = rangeSourceInfo.sourceRange || normalRange;
      
      const agentCal = agentCalibrationRecords[def.key] || null;
      const optVal = customDef?.optimalValue || (agentCal ? formatOptimalTargetValue(agentCal) : '');
      
      const riskCats = (def.riskCategories || customDef?.riskCategories || []).join('; ');
      
      const potConds = (def.potentialMedicalConditions || customDef?.potentialMedicalConditions || []).join('; ');

      const logs = activeHistory
        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
        .map(h => \`\${h.date}: \${h.biomarkers[key]}\`)
        .join(' | ');

      return [
        \`"\${name.replace(/"/g, '""')}"\`,
        \`"\${key.replace(/"/g, '""')}"\`,
        \`"\${unit.replace(/"/g, '""')}"\`,
        \`"\${normalRange.replace(/"/g, '""')}"\`,
        \`"\${customRange.replace(/"/g, '""')}"\`,
        \`"\${clinicalReferenceRange.replace(/"/g, '""')}"\`,
        \`"\${String(optVal).replace(/"/g, '""')}"\`,
        \`"\${riskCats.replace(/"/g, '""')}"\`,
        \`"\${potConds.replace(/"/g, '""')}"\`,
        \`"\${logs.replace(/"/g, '""')}"\`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', \`biomarkers_export_\${new Date().toISOString().split('T')[0]}.csv\`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
`;

code = code.replace(
  /const totalUniqueBiomarkers = useMemo\(\(\) => \{/,
  funcString + '\n  const totalUniqueBiomarkers = useMemo(() => {'
);

// Modify the Tracked Biomarkers text to be clickable
code = code.replace(
  /<span>Tracked Biomarkers: <strong className="text-slate-800 dark:text-slate-200 font-bold">\{totalUniqueBiomarkers\}<\/strong><\/span>/,
  `<span onClick={exportBiomarkersToCSV} className="cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="Download as CSV">Tracked Biomarkers: <strong className="text-slate-800 dark:text-slate-200 font-bold">{totalUniqueBiomarkers}</strong></span>`
);

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
