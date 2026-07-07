const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex1 = /          if \(\(val\.startsWith\('"'\) && val\.endsWith\('"'\)\) \|\| \(val\.startsWith\("'"\) && val\.endsWith\("'"\)\)\) \{\n            val = val\.substring\(1, val\.length - 1\);\n          \}\n          currentGroup\[key\] = val;\n        \}/g;

const regex2 = /          if \(\(val\.startsWith\('"'\) && val\.endsWith\('"'\)\) \|\| \(val\.startsWith\("'"\) && val\.endsWith\("'"\)\)\) \{\n            val = val\.substring\(1, val\.length - 1\);\n          \}\n          \n          if \(currentBiomarker && indent >= 4\) \{\n            currentBiomarker\[key\] = val;\n          \} else if \(currentGroup && indent < 4\) \{\n            currentGroup\[key\] = val;\n          \}\n        \}/g;

code = code.replace(regex1, `          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          if (key !== 'biomarkers') {
            currentGroup[key] = val;
          }
        }`);

code = code.replace(regex2, `          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          
          if (currentBiomarker && indent >= 4) {
            if (key !== 'biomarkers') {
              currentBiomarker[key] = val;
            }
          } else if (currentGroup && indent < 4) {
            if (key !== 'biomarkers') {
              currentGroup[key] = val;
            }
          }
        }`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
