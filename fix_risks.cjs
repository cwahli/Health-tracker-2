const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const parseBlock = `          // Always process riskCategories and potentialMedicalConditions even if undefined
          // so that non-selected ones are explicitly removed (set to empty array) when accepting categorisation
          if (item.riskCategories !== undefined) {
             try {
                updatesToApply[item.key].riskCategories = Array.isArray(item.riskCategories) ? item.riskCategories : JSON.parse(item.riskCategories);
             } catch (e) {
                updatesToApply[item.key].riskCategories = typeof item.riskCategories === 'string' ? item.riskCategories.split(',').map(s=>s.trim()) : [];
             }
          } else if (isMedicalCategorisationMode) {
             updatesToApply[item.key].riskCategories = [];
          }`;

const parseRepl = `          // Always process riskCategories and potentialMedicalConditions even if undefined
          // so that non-selected ones are explicitly removed (set to empty array) when accepting categorisation
          if (item.riskCategories !== undefined) {
             try {
                updatesToApply[item.key].riskCategories = Array.isArray(item.riskCategories) ? item.riskCategories : JSON.parse(item.riskCategories);
             } catch (e) {
                updatesToApply[item.key].riskCategories = typeof item.riskCategories === 'string' ? item.riskCategories.split(',').map((s: string)=>s.trim()) : [];
             }
          } else if (isMedicalCategorisationMode) {
             updatesToApply[item.key].riskCategories = [];
          }
          if (isMedicalCategorisationMode && updatesToApply[item.key].riskCategories) {
             const allowedRisks = ["Cardiovascular", "Kidney", "Metabolic", "Liver", "Hematology", "Wellness", "Screenings"];
             updatesToApply[item.key].riskCategories = updatesToApply[item.key].riskCategories.filter((r: string) => allowedRisks.includes(r));
          }`;

code = code.replace(parseBlock, parseRepl);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
