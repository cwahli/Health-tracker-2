const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldHeader = `<h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          Step 2: Review Proposed Standardizations
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Review the units and reference ranges computed by the clinical standardization agent. If approved, these will be applied to your active biomarker dictionary.
                        </p>`;

const newHeader = `<h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          {isMedicalCategorisationMode ? "Step 2: Review Proposed Categorisations" : "Step 2: Review Proposed Standardizations"}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {isMedicalCategorisationMode 
                            ? "Review the physiological groupings and risk categories computed by the clinical categorisation agent. If approved, these will be applied to your active biomarker dictionary." 
                            : "Review the units and reference ranges computed by the clinical standardization agent. If approved, these will be applied to your active biomarker dictionary."}
                        </p>`;

code = code.replace(oldHeader, newHeader);

const oldBtn = `Approve & Apply Unit Standardization`;
const newBtn = `{isMedicalCategorisationMode ? "Approve & Apply Categorisation" : "Approve & Apply Unit Standardization"}`;
code = code.replace(oldBtn, newBtn);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal title");
