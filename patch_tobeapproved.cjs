const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const approveSelectedBtn = `
                    <div className="flex items-center gap-3">
                      {selectedKeys.some(k => toApproveKeys.includes(k)) && (
                        <button
                          onClick={() => {
                            const updates = {};
                            selectedKeys.forEach(k => {
                              if (toApproveKeys.includes(k)) {
                                updates[k] = { name: k, unit: '' };
                              }
                            });
                            // Assuming onStandardizeUnits can take an object of custom definitions, or we need to dispatch profile update directly.
                            // Let's call onSave for each, or we can add a batch update in App.tsx. 
                            // Since BiomarkerDictionaryModal doesn't have onBatchSave, we can use onUpdateProfile if available, or just call onSave?
                            // Wait, onSave in DictionaryItem calls onSave prop. Let's see how onSave is passed to DictionaryItem:
                            // onSave={(updates) => {
                            //  // Wait, the parent has handleUpdateCustomBiomarker(updates)
                            // }}
                            // Let's just create a new customBiomarkers object and update profile.
                            const updatedCustom = { ...(profile.customBiomarkers || {}) };
                            let hasChanges = false;
                            selectedKeys.forEach(k => {
                              if (toApproveKeys.includes(k)) {
                                updatedCustom[k] = { name: k, unit: '', normalRange: '', description: '' };
                                hasChanges = true;
                              }
                            });
                            if (hasChanges) {
                              onUpdateProfile({ ...profile, customBiomarkers: updatedCustom });
                              setSelectedKeys(selectedKeys.filter(k => !toApproveKeys.includes(k)));
                            }
                          }}
                          className="text-xs font-bold px-2 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 rounded hover:bg-emerald-200"
                        >
                          Approve Selected
                        </button>
                      )}
                      <button 
                        onClick={() => handleToggleSelectAll(toApproveKeys)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {toApproveKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                      </button>
                    </div>
`;

code = code.replace(
  `                  {toApproveKeys.length > 0 && (
                    <button 
                      onClick={() => handleToggleSelectAll(toApproveKeys)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {toApproveKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                    </button>
                  )}`,
  `                  {toApproveKeys.length > 0 && (${approveSelectedBtn})}`
);

// Add explanation to DictionaryItem
code = code.replace(
  '<DictionaryItem',
  '<DictionaryItem\n                          approvalReason="Found in uploaded logs but missing a standardized dictionary definition. Please review, standardize, or approve it manually to add it to your profile."'
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched to be approved UI");
