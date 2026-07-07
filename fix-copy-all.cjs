const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldCopy = `                <button
                  onClick={() => {
                    const allKeys = Array.from(new Set([...toApproveKeys, ...biomarkerDefinitions.map(d => d.key), ...Object.keys(profile.customBiomarkers || {})]));
                    const csvContent = allKeys.map(k => {
                      const d = profile.customBiomarkers?.[k] || biomarkerDefinitions.find(bd => bd.key === k) || { name: k, unit: '' };
                      const latestValue = biomarkers[k] !== undefined ? biomarkers[k] : 'N/A';
                      const unit = d.unit || '';
                      return \`\${d.name || k} (\${k}): \${latestValue} \${unit}\`.trim();
                    }).join('\\n');
                    navigator.clipboard.writeText(csvContent);
                    alert('Copied ' + allKeys.length + ' biomarkers to clipboard!');
                  }}`;

const newCopy = `                <button
                  onClick={() => {
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

if (code.includes(oldCopy)) {
  code = code.replace(oldCopy, newCopy);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed copy all');
} else {
  console.log('Could not find oldCopy in BiomarkerDictionaryModal.tsx');
}
