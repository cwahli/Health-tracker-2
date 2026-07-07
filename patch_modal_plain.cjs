const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldModalStart = `  const handleNormalRangeChange = (val: string) => {`;
const oldModalEnd = `          }
        }
      }
    }
    
    setEditState({
      ...editState,
      normalRange: val,
      rangeConfig: newRangeConfig
    });
  };`;

const oldModalFull = code.substring(code.indexOf(oldModalStart), code.indexOf(oldModalEnd) + oldModalEnd.length);

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
      rangeConfig: newRangeConfig
    });
  };`;

code = code.replace(oldModalFull, newModalFull);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal plain");
