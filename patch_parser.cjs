const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldParserStart = `const parseNormalRangeStr = (val: string | undefined, type: 'simple' | 'bracket'): RangeConfig => {`;
const oldParserEnd = `    }
};

export const BiomarkerRangeBuilder`;

const oldParserFull = code.substring(code.indexOf(oldParserStart), code.indexOf(oldParserEnd) + 6);

const newParser = `const parseNormalRangeStr = (val: string | undefined, type: 'simple' | 'bracket'): RangeConfig => {
    if (!val) return type === 'simple' ? defaultSimpleRange : defaultBracketRange;
    val = val.trim().toLowerCase();
    
    if (type === 'bracket') {
      const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/);
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
      
      const lessMatch = val.match(/^(<|<=|under|less than|below)\\s*([\\d.]+)$/);
      if (lessMatch) {
        const v = parseFloat(lessMatch[2]);
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
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\\s*([\\d.]+)$/);
      if (greaterMatch) {
        const v = parseFloat(greaterMatch[2]);
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
      return defaultBracketRange;
    } else {
      const lessMatch = val.match(/^(<|<=|under|less than|below)\\s*([\\d.]+)$/);
      if (lessMatch) {
        const v = parseFloat(lessMatch[2]);
        if (!isNaN(v)) {
          const isLessEq = lessMatch[1] === '<=';
          return {
            type: 'simple',
            conditions: [
              { operator: isLessEq ? '<=' : '<', value: v, alias: 'Healthy', severity: 'Normal' },
              { operator: isLessEq ? '>' : '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]
          };
        }
      }
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\\s*([\\d.]+)$/);
      if (greaterMatch) {
        const v = parseFloat(greaterMatch[2]);
        if (!isNaN(v)) {
          const isGreaterEq = greaterMatch[1] === '>=';
          return {
            type: 'simple',
            conditions: [
              { operator: isGreaterEq ? '>=' : '>', value: v, alias: 'Healthy', severity: 'Normal' },
              { operator: isGreaterEq ? '<' : '<=', value: v, alias: 'Low', severity: 'At risk' }
            ]
          };
        }
      }
      return defaultSimpleRange;
    }
};
`;

code = code.replace(oldParserFull, newParser);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched parser logic");
