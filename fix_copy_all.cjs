const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const target = `                  onClick={() => {
                    const filteredKeysToCopy = Array.from(new Set([...toApproveKeys, ...allApprovedKeys]));
                    const csvContent = filteredKeysToCopy.map(k => {
                      const d = profile.customBiomarkers?.[k] || biomarkerDefinitions.find(bd => bd.key === k) || { name: k, unit: '' };
                      const latestValue = biomarkers[k] !== undefined ? biomarkers[k] : 'N/A';
                      const unit = d.unit || '';
                      return \`\${d.name || k} (\${k}): \${latestValue} \${unit}\`.trim();
                    }).join('\\n');
                    navigator.clipboard.writeText(csvContent);
                    alert('Copied ' + filteredKeysToCopy.length + ' biomarkers to clipboard!');
                  }}`;

const replace = `                  onClick={() => {
                    const filteredKeysToCopy = selectedKeys.length > 0 ? selectedKeys : Array.from(new Set([...toApproveKeys, ...allApprovedKeys]));
                    const csvContent = filteredKeysToCopy.map(k => {
                      const d = profile.customBiomarkers?.[k] || biomarkerDefinitions.find(bd => bd.key === k) || { name: k, unit: '' };
                      const unit = d.unit || '';
                      const range = d.normalRange ? \` (Range: \${d.normalRange})\` : '';
                      
                      const logsForBiomarker = biomarkerHistory
                        .filter(log => log.biomarkers[k] !== undefined)
                        .sort((a, b) => b.date.localeCompare(a.date));
                        
                      let logString = '';
                      if (logsForBiomarker.length > 0) {
                        logString = logsForBiomarker.map(log => \`  - \${log.date}: \${log.biomarkers[k]} \${unit}\`).join('\\n');
                      } else {
                        const latestValue = biomarkers[k] !== undefined ? biomarkers[k] : 'N/A';
                        logString = \`  - Latest: \${latestValue} \${unit}\`;
                      }
                      
                      return \`\${d.name || k} (\${k})\${range}:\\n\${logString}\`;
                    }).join('\\n\\n');
                    
                    navigator.clipboard.writeText(csvContent);
                    alert('Copied ' + filteredKeysToCopy.length + ' biomarkers to clipboard!');
                  }}`;

if(code.includes(target)) {
  code = code.split(target).join(replace);
  console.log("Updated Copy All functionality");
} else {
  console.log("Could not find Copy All");
}

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
