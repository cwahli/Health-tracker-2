const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldComponent = `export const BiomarkerRangeBuilder: React.FC<BiomarkerRangeBuilderProps> = ({ rangeConfig, customRanges = [], normalRangeStr, onChange }) => {
  const parseNormalRangeStr = (val: string | undefined, type: 'simple' | 'bracket'): RangeConfig => {
    if (!val) return type === 'simple' ? defaultSimpleRange : defaultBracketRange;
    val = val.trim();
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
      return defaultBracketRange;
    } else {
      const lessMatch = val.match(/^<\\s*([\\d.]+)$/);
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
      const greaterMatch = val.match(/^>\\s*([\\d.]+)$/);
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
      const lessEqMatch = val.match(/^<=\\s*([\\d.]+)$/);
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
      const greaterEqMatch = val.match(/^>=\\s*([\\d.]+)$/);
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
      return defaultSimpleRange;
    }
  };
`;

const newComponent = `const parseNormalRangeStr = (val: string | undefined, type: 'simple' | 'bracket'): RangeConfig => {
    if (!val) return type === 'simple' ? defaultSimpleRange : defaultBracketRange;
    val = val.trim();
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
      return defaultBracketRange;
    } else {
      const lessMatch = val.match(/^<\\s*([\\d.]+)$/);
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
      const greaterMatch = val.match(/^>\\s*([\\d.]+)$/);
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
      const lessEqMatch = val.match(/^<=\\s*([\\d.]+)$/);
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
      const greaterEqMatch = val.match(/^>=\\s*([\\d.]+)$/);
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
      return defaultSimpleRange;
    }
};

export const BiomarkerRangeBuilder: React.FC<BiomarkerRangeBuilderProps> = ({ rangeConfig, customRanges = [], normalRangeStr, onChange }) => {`;

code = code.replace(oldComponent, newComponent);

const oldRangeEditor = `<RangeEditor 
             range={rangeConfig} 
             onChange={updateNormalRange} 
             title="Base Normal Range"
          />`;

const newRangeEditor = `<RangeEditor 
             range={rangeConfig} 
             normalRangeStr={normalRangeStr}
             onChange={updateNormalRange} 
             title="Base Normal Range"
          />`;

code = code.replace(oldRangeEditor, newRangeEditor);

const oldCustomRangeEditor = `<RangeEditor 
                  range={cr.rangeConfig} 
                  onChange={r => {
                    const next = [...customRanges];
                    if (r) next[idx].rangeConfig = r;
                    else {
                      // If undefined returned, we might want to default to simple
                      next[idx].rangeConfig = defaultSimpleRange;
                    }
                    updateCustomRanges(next);
                  }} 
                  title="Override Range"
                />`;
const newCustomRangeEditor = `<RangeEditor 
                  range={cr.rangeConfig} 
                  normalRangeStr={normalRangeStr}
                  onChange={r => {
                    const next = [...customRanges];
                    if (r) next[idx].rangeConfig = r;
                    else {
                      // If undefined returned, we might want to default to simple
                      next[idx].rangeConfig = defaultSimpleRange;
                    }
                    updateCustomRanges(next);
                  }} 
                  title="Override Range"
                />`;
code = code.replace(oldCustomRangeEditor, newCustomRangeEditor);

const oldRangeEditorProps = `const RangeEditor: React.FC<{ range?: RangeConfig, onChange: (r?: RangeConfig) => void, title: string }> = ({ range, onChange, title }) => {`;
const newRangeEditorProps = `const RangeEditor: React.FC<{ range?: RangeConfig, normalRangeStr?: string, onChange: (r?: RangeConfig) => void, title: string }> = ({ range, normalRangeStr, onChange, title }) => {`;
code = code.replace(oldRangeEditorProps, newRangeEditorProps);

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);

let dictCode = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldDictMap = `                    {Object.entries(parsedMapping).map(([oldKey, newKey]) => (
                      <div key={oldKey} className="flex justify-between items-center text-[10px] font-mono py-1 border-b border-slate-100/30 dark:border-slate-800/20 last:border-0 text-slate-600 dark:text-slate-400">
                        <span className="truncate flex-1 max-w-[45%] text-rose-600/70 line-through">{oldKey}</span>
                        <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
                        <span className="truncate flex-1 max-w-[45%] text-emerald-600 font-bold text-right">{newKey as string}</span>
                      </div>
                    ))}
                  </div>`;
const newDictMap = `                    {Object.entries(parsedMapping).map(([oldKey, newKey]) => (
                      <div key={oldKey} className="flex justify-between items-center text-[10px] font-mono py-1 border-b border-slate-100/30 dark:border-slate-800/20 last:border-0 text-slate-600 dark:text-slate-400">
                        <span className="truncate flex-1 max-w-[45%] text-rose-600/70 line-through">{oldKey}</span>
                        <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
                        <span className="truncate flex-1 max-w-[45%] text-emerald-600 font-bold text-right">{String(newKey)}</span>
                      </div>
                    ))}
                  </div>`;
dictCode = dictCode.replace(oldDictMap, newDictMap);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', dictCode);

console.log("Patched range editor");
