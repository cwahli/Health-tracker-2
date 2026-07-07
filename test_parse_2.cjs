const parseNormalRangeStr = (val) => {
  if (!val) return null;
  val = val.trim();
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
  const lessMatch = val.match(/^<\s*([\d.]+)$/);
  if (lessMatch) {
    const v = parseFloat(lessMatch[1]);
    if (!isNaN(v)) {
      return {
        type: 'simple',
        conditions: [
          { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
          { operator: '>=', value: v, alias: 'High', severity: 'At risk' }
        ]
      };
    }
  }
  const greaterMatch = val.match(/^>\s*([\d.]+)$/);
  if (greaterMatch) {
    const v = parseFloat(greaterMatch[1]);
    if (!isNaN(v)) {
      return {
        type: 'simple',
        conditions: [
          { operator: '>', value: v, alias: 'Normal', severity: 'Normal' },
          { operator: '<=', value: v, alias: 'Low', severity: 'At risk' }
        ]
      };
    }
  }
  const lessEqMatch = val.match(/^<=\s*([\d.]+)$/);
  if (lessEqMatch) {
    const v = parseFloat(lessEqMatch[1]);
    if (!isNaN(v)) {
      return {
        type: 'simple',
        conditions: [
          { operator: '<=', value: v, alias: 'Normal', severity: 'Normal' },
          { operator: '>', value: v, alias: 'High', severity: 'At risk' }
        ]
      };
    }
  }
  const greaterEqMatch = val.match(/^>=\s*([\d.]+)$/);
  if (greaterEqMatch) {
    const v = parseFloat(greaterEqMatch[1]);
    if (!isNaN(v)) {
      return {
        type: 'simple',
        conditions: [
          { operator: '>=', value: v, alias: 'Normal', severity: 'Normal' },
          { operator: '<', value: v, alias: 'Low', severity: 'At risk' }
        ]
      };
    }
  }
  return null;
}
console.log(parseNormalRangeStr("7 - 56"));
console.log(parseNormalRangeStr("< 50"));
console.log(parseNormalRangeStr(">= 0.5"));
