const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const parseFunction = `  const handleNormalRangeChange = (val: string) => {
    let newRangeConfig = editState.rangeConfig;
    
    const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/);
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
      const lessMatch = val.match(/^<\\s*([\\d.]+)$/);
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
        const greaterMatch = val.match(/^>\\s*([\\d.]+)$/);
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
          const lessEqMatch = val.match(/^<=\\s*([\\d.]+)$/);
          if (lessEqMatch) {
            const v = parseFloat(lessEqMatch[1]);
            if (!isNaN(v)) {
              newRangeConfig = {
                type: 'simple',
                conditions: [
                  { operator: '<=', value: v, alias: 'Normal', severity: 'Normal' },
                  { operator: '>', value: v, alias: 'Elevated', severity: 'At risk' }
                ]
              };
            }
          } else {
            const greaterEqMatch = val.match(/^>=\\s*([\\d.]+)$/);
            if (greaterEqMatch) {
              const v = parseFloat(greaterEqMatch[1]);
              if (!isNaN(v)) {
                newRangeConfig = {
                  type: 'simple',
                  conditions: [
                    { operator: '>=', value: v, alias: 'Normal', severity: 'Normal' },
                    { operator: '<', value: v, alias: 'Low', severity: 'At risk' }
                  ]
                };
              }
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
  };

  const handleRangeConfigChange = (r: any, c: any) => {
    let newNormalRange = editState.normalRange;
    if (r) {
      if (r.type === 'bracket' && r.brackets && r.brackets.length > 0) {
        const normalBracket = r.brackets.find((b: any) => b.severity === 'Normal');
        if (normalBracket && normalBracket.min !== null && normalBracket.max !== null) {
          newNormalRange = \`\${normalBracket.min} - \${normalBracket.max}\`;
        }
      } else if (r.type === 'simple' && r.conditions && r.conditions.length > 0) {
        const normalCond = r.conditions.find((c: any) => c.severity === 'Normal');
        if (normalCond) {
          newNormalRange = \`\${normalCond.operator} \${normalCond.value}\`;
        }
      }
    }
    setEditState({ ...editState, rangeConfig: r, customRanges: c, normalRange: newNormalRange });
  };
  const handleSave = () => {`;

code = code.replace("  const handleSave = () => {", parseFunction);

const oldInput = `                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.normalRange}
                      onChange={e => setEditState({...editState, normalRange: e.target.value})}
                    />`;

const newInput = `                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.normalRange}
                      onChange={e => handleNormalRangeChange(e.target.value)}
                    />`;
code = code.replace(oldInput, newInput);

const oldRangeBuilder = `                  <BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    onChange={(r, c) => setEditState({ ...editState, rangeConfig: r, customRanges: c })}
                  />`;

const newRangeBuilder = `                  <BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    onChange={handleRangeConfigChange}
                  />`;

code = code.replace(oldRangeBuilder, newRangeBuilder);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal sync");
