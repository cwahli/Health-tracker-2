const fs = require('fs');
let code = fs.readFileSync('src/components/ReviewBiomarkerModal.tsx', 'utf8');

const relatedBlock = `        if (latestVal !== 'N/A') {
          const customDetail = (profile.customBiomarkers?.[otherDef.key] || {}) as any;
          const medicalInsights = customDetail.specificRiskContext || otherDef.description || otherDef.descriptions?.en || '';
          
          tagMatches.push({
            key: otherDef.key,
            name: otherDef.name,
            latest_value: latestVal,
            unit: otherDef.unit || '',
            latest_date: latestDate,
            medical_insights: medicalInsights
          });
        }`;

const relatedRepl = `        const customDetail = (profile.customBiomarkers?.[otherDef.key] || {}) as any;
        const medicalInsights = customDetail.specificRiskContext || otherDef.description || otherDef.descriptions?.en || '';
        
        tagMatches.push({
          key: otherDef.key,
          name: otherDef.name,
          latest_value: latestVal,
          unit: otherDef.unit || '',
          latest_date: latestDate,
          medical_insights: medicalInsights
        });`;

code = code.replace(relatedBlock, relatedRepl);
fs.writeFileSync('src/components/ReviewBiomarkerModal.tsx', code);
