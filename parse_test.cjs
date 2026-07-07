const parseNormalRangeStr = (val, type) => {
    if (!val) return type === 'simple' ? { type: 'simple', conditions: [] } : { type: 'bracket', brackets: [] };
    val = val.trim().toLowerCase();
    
    // strip out units from val for matching
    // we match numbers, operators (<, <=, etc), and hyphens. 
    // Actually, just changing regex to allow trailing non-digit text
    if (type === 'bracket') {
      const bracketMatch = val.match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/);
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
      
      const lessMatch = val.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
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
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/);
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
      return { type: 'bracket', brackets: [
        { min: null, max: 0, alias: 'Normal', severity: 'Normal' },
        { min: 0, max: null, alias: 'High', severity: 'At risk' }
      ] };
    } else {
      const lessMatch = val.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
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
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/);
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
      return {
        type: 'simple',
        conditions: [
            { operator: '>=', value: 0, alias: 'Elevated', severity: 'At risk' },
            { operator: '<', value: 0, alias: 'Healthy', severity: 'Normal' }
        ]
      };
    }
};

console.log(parseNormalRangeStr('80-120 mL/min/1.73m2', 'bracket'));
console.log(parseNormalRangeStr('< 5.0 mmol/L', 'simple'));
