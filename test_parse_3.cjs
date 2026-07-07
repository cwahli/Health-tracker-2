const parseNormalRangeStr = (val, type) => {
    if (!val) return type === 'simple' ? { type: 'simple', conditions: [] } : { type: 'bracket', brackets: [] };
    val = val.trim();
    if (type === 'bracket') {
      const bracketMatch = val.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
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
      
      const lessMatch = val.match(/^<={0,1}\s*([\d.]+)$/);
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
      const greaterMatch = val.match(/^>={0,1}\s*([\d.]+)$/);
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
      return { type: 'bracket', brackets: [
        { min: null, max: 0, alias: 'Normal', severity: 'Normal' },
        { min: 0, max: null, alias: 'High', severity: 'At risk' }
      ] };
    } else {
        // Simple type
    }
}
console.log(parseNormalRangeStr("< 50", 'bracket'));
console.log(parseNormalRangeStr("> 2.5", 'bracket'));
