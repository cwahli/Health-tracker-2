const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldParse = `      const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/);
      if (bracketMatch) {
        const min = parseFloat(bracketMatch[1]);
        const max = parseFloat(bracketMatch[2]);
        if (!isNaN(min) && !isNaN(max)) {
          return {
            type: 'bracket',
            brackets: [
              { min: null, max: min, alias: 'Low', severity: 'At risk' },
              { min: min, max: max, alias: 'Normal', severity: 'Normal' },
              { min: max, max: null, alias: 'High', severity: 'At risk' }
            ]
          };
        }
      }
      return defaultBracketRange;`;

const newParse = `      const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/);
      if (bracketMatch) {
        const min = parseFloat(bracketMatch[1]);
        const max = parseFloat(bracketMatch[2]);
        if (!isNaN(min) && !isNaN(max)) {
          return {
            type: 'bracket',
            brackets: [
              { min: null, max: min, alias: 'Low', severity: 'At risk' },
              { min: min, max: max, alias: 'Normal', severity: 'Normal' },
              { min: max, max: null, alias: 'High', severity: 'At risk' }
            ]
          };
        }
      }
      const lessMatch = val.match(/^<={0,1}\\s*([\\d.]+)$/);
      if (lessMatch) {
        const v = parseFloat(lessMatch[1]);
        if (!isNaN(v)) {
            return {
                type: 'bracket',
                brackets: [
                    { min: null, max: v, alias: 'Normal', severity: 'Normal' },
                    { min: v, max: null, alias: 'High', severity: 'At risk' }
                ]
            }
        }
      }
      const greaterMatch = val.match(/^>={0,1}\\s*([\\d.]+)$/);
      if (greaterMatch) {
        const v = parseFloat(greaterMatch[1]);
        if (!isNaN(v)) {
            return {
                type: 'bracket',
                brackets: [
                    { min: null, max: v, alias: 'Low', severity: 'At risk' },
                    { min: v, max: null, alias: 'Normal', severity: 'Normal' }
                ]
            }
        }
      }
      return defaultBracketRange;`;

code = code.replace(oldParse, newParse);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched range builder 2");
