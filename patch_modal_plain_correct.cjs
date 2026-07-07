const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldModalStart = `  const handleNormalRangeChange = (val: string) => {`;
const oldModalEnd = `        }
      }
    }
    setEditState({
      ...editState, 
      normalRange: val,
      ...(newRangeConfig ? { rangeConfig: newRangeConfig } : {})
    });
  };`;

const startIndex = code.indexOf(oldModalStart);
const endIndex = code.indexOf(oldModalEnd, startIndex) + oldModalEnd.length;

if (startIndex === -1 || code.indexOf(oldModalEnd, startIndex) === -1) {
    console.error("COULD NOT FIND STRING TO REPLACE!");
    console.log("Start Index:", startIndex);
    console.log("End Index:", code.indexOf(oldModalEnd, startIndex));
    process.exit(1);
}

const oldModalFull = code.substring(startIndex, endIndex);

const newModalFull = `  const handleNormalRangeChange = (val: string) => {
    let newRangeConfig = editState.rangeConfig;
    
    const bracketMatch = val.trim().match(/^([\\d.]+)\\s*-\\s*([\\d.]+)(?:\\s+.*)?$/);
    if (bracketMatch) {
      const min = parseFloat(bracketMatch[1]);
      const max = parseFloat(bracketMatch[2]);
      if (!isNaN(min) && !isNaN(max)) {
        newRangeConfig = {
          type: 'bracket',
          brackets: [
            { min: null, max: min, alias: 'Low', severity: 'At risk' },
            { min: min, max: max, alias: 'Normal', severity: 'Normal' },
            { min: max, max: null, alias: 'Elevated', severity: 'At risk' }
          ]
        };
      }
    } else {
      const lessMatch = val.trim().match(/^(?:<|<=|under|less than|below)\\s*([\\d.]+)(?:\\s+.*)?$/i);
      if (lessMatch) {
        const v = parseFloat(lessMatch[1]);
        if (!isNaN(v)) {
          newRangeConfig = {
            type: 'simple',
            conditions: [
              { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
              { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]
          };
        }
      } else {
        const greaterMatch = val.trim().match(/^(?:>|>=|over|greater than|above)\\s*([\\d.]+)(?:\\s+.*)?$/i);
        if (greaterMatch) {
          const v = parseFloat(greaterMatch[1]);
          if (!isNaN(v)) {
            newRangeConfig = {
              type: 'simple',
              conditions: [
                { operator: '>', value: v, alias: 'Normal', severity: 'Normal' },
                { operator: '<=', value: v, alias: 'Low', severity: 'At risk' }
              ]
            };
          }
        } else {
          const plainMatch = val.trim().match(/^([\\d.]+)(?:\\s+.*)?$/);
          if (plainMatch) {
            const v = parseFloat(plainMatch[1]);
            if (!isNaN(v)) {
              newRangeConfig = {
                type: 'simple',
                conditions: [
                  { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
                  { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
                ]
              };
            }
          }
        }
      }
    }
    setEditState({
      ...editState, 
      normalRange: val,
      ...(newRangeConfig ? { rangeConfig: newRangeConfig } : {})
    });
  };`;

code = code.substring(0, startIndex) + newModalFull + code.substring(endIndex);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched correctly!");
