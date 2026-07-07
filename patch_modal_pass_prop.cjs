const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldComponent = `<BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    onChange={handleRangeConfigChange}
                  />`;

const newComponent = `<BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    normalRangeStr={editState.normalRange}
                    onChange={handleRangeConfigChange}
                  />`;
code = code.replace(oldComponent, newComponent);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched prop in modal");
