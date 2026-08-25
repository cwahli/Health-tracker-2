const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

// 1. Add import
if (!code.includes('generateDynamicInsight')) {
  code = code.replace(
    "import { getBiomarkerRangeSourceInfo } from '../utils/biomarkerLifecycle';",
    "import { getBiomarkerRangeSourceInfo } from '../utils/biomarkerLifecycle';\nimport { generateDynamicInsight } from '../utils/biomarkerInsights';"
  );
}

// 2. Replace exportBiomarkersToCSV
const oldExportMatch = code.match(/const exportBiomarkersToCSV = \(\) => \{[\s\S]*?document\.body\.removeChild\(link\);\s*\};\s*const totalUniqueBiomarkers/);

if (oldExportMatch) {
  const newExport = `const exportBiomarkersToCSV = () => {
    const headers = [
      "Biomarker Name", 
      "Key",
      "Alias",
      "Description",
      "Unit", 
      "Normal Range", 
      "Custom Range", 
      "Clinical Reference Range", 
      "Optimal Target Value",
      "Medical Practice",
      "Risk Categories", 
      "Medical Conditions",
      "Current Evaluation Status",
      "Medical Insight",
      "Historical Logs (Date: Value)",
      "Not Used"
    ];

    const rows = filteredBiomarkers.map(def => {
      const customDef = getCustomBiomarkerDef(profile, def.key);
      const name = def.name || customDef?.name || def.key;
      const key = def.key;
      const aliases = (def.aliases || customDef?.aliases || []).join('; ');
      const desc = def.descriptions?.en || def.description || customDef?.descriptions?.en || customDef?.description || '';
      const unit = def.unit || customDef?.unit || '';
      
      const normalRange = def.normalRange || '';
      const customRange = customDef?.normalRange || '';
      
      const rangeSourceInfo = getBiomarkerRangeSourceInfo(key, def, profile);
      const clinicalReferenceRange = rangeSourceInfo.sourceRange || normalRange;
      
      const agentCal = agentCalibrationRecords[def.key] || null;
      const optVal = customDef?.optimalValue || (agentCal ? formatOptimalTargetValue(agentCal) : '');
      
      const medicalPractice = def.standardMedicalGrouping || customDef?.standardMedicalGrouping || '';
      const riskCats = (def.riskCategories || customDef?.riskCategories || []).join('; ');
      
      const potConds = (def.potentialMedicalConditions || customDef?.potentialMedicalConditions || []).join('; ');

      // Current Evaluation Status & Medical Insight
      const latestVal = biomarkers[key];
      const hasVal = !isValEmpty(latestVal);
      let evalStatus = 'No recent data';
      let insightText = '';
      if (hasVal) {
        const status = getBiomarkerStatus(key, latestVal, def.normalRange, def.unit, profile);
        const statusLabel = getBiomarkerStatusLabel(key, status, customDef, latestVal, profile);
        const riskTag = getBiomarkerRiskTag(key, status, customDef, latestVal, profile);
        evalStatus = \`Value: \${latestVal} | Status: \${statusLabel} | Risk: \${riskTag || 'N/A'}\`;
        insightText = generateDynamicInsight(def, profile, latestVal, status);
      }
      
      const notUsed = isKeyNotUsedInMedicalHistory(key) ? "TRUE" : "FALSE";

      const logs = activeHistory
        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
        .map(h => {
          let logStr = \`Date: \${h.date} | Value: \${h.biomarkers[key]}\`;
          if (h.tests) {
             const test = h.tests.find(t => t.key === key);
             if (test) {
                const details = [];
                if (test.originalTestName) details.push(\`Original Name: \${test.originalTestName}\`);
                if (test.normalRange) details.push(\`Extracted Range: \${test.normalRange}\`);
                if (test.doctorComment) details.push(\`Doctor/Lab Comment:\\n\${test.doctorComment}\`);
                if (details.length > 0) {
                   logStr += \`\\n\${details.join('\\n')}\`;
                }
             }
          }
          return logStr;
        })
        .join('\\n\\n---\\n\\n');

      return [
        \`"\${name.replace(/"/g, '""')}"\`,
        \`"\${key.replace(/"/g, '""')}"\`,
        \`"\${aliases.replace(/"/g, '""')}"\`,
        \`"\${desc.replace(/"/g, '""')}"\`,
        \`"\${unit.replace(/"/g, '""')}"\`,
        \`"\${normalRange.replace(/"/g, '""')}"\`,
        \`"\${customRange.replace(/"/g, '""')}"\`,
        \`"\${clinicalReferenceRange.replace(/"/g, '""')}"\`,
        \`"\${String(optVal).replace(/"/g, '""')}"\`,
        \`"\${medicalPractice.replace(/"/g, '""')}"\`,
        \`"\${riskCats.replace(/"/g, '""')}"\`,
        \`"\${potConds.replace(/"/g, '""')}"\`,
        \`"\${evalStatus.replace(/"/g, '""')}"\`,
        \`"\${insightText.replace(/"/g, '""')}"\`,
        \`"\${logs.replace(/"/g, '""')}"\`,
        \`"\${notUsed}"\`
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

  const totalUniqueBiomarkers`;

  code = code.replace(oldExportMatch[0], newExport);
  fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
  console.log("Successfully patched MedicalHistoryTab.tsx export function!");
} else {
  console.log("Could not match the exportBiomarkersToCSV block.");
}
