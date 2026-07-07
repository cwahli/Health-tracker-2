const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldProps = `interface BiomarkerRangeBuilderProps {
  rangeConfig?: RangeConfig;
  customRanges?: CustomRangeDef[];
  onChange: (rangeConfig?: RangeConfig, customRanges?: CustomRangeDef[]) => void;
}`;

const newProps = `interface BiomarkerRangeBuilderProps {
  rangeConfig?: RangeConfig;
  customRanges?: CustomRangeDef[];
  normalRangeStr?: string;
  onChange: (rangeConfig?: RangeConfig, customRanges?: CustomRangeDef[]) => void;
}`;
code = code.replace(oldProps, newProps);

const oldComponent = `export const BiomarkerRangeBuilder: React.FC<BiomarkerRangeBuilderProps> = ({ rangeConfig, customRanges = [], onChange }) => {`;

const newComponent = `export const BiomarkerRangeBuilder: React.FC<BiomarkerRangeBuilderProps> = ({ rangeConfig, customRanges = [], normalRangeStr, onChange }) => {
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
code = code.replace(oldComponent, newComponent);

const oldCreateSimple = `                  <button
                    type="button"
                    onClick={() => onChange(defaultSimpleRange)}
                    className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                  >
                    Create Simple Range
                  </button>`;
const newCreateSimple = `                  <button
                    type="button"
                    onClick={() => onChange(parseNormalRangeStr(normalRangeStr, 'simple'))}
                    className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                  >
                    Create Simple Range
                  </button>`;
code = code.replace(oldCreateSimple, newCreateSimple);

const oldCreateBracket = `                  <button
                    type="button"
                    onClick={() => onChange(defaultBracketRange)}
                    className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                  >
                    Create Bracket Range
                  </button>`;
const newCreateBracket = `                  <button
                    type="button"
                    onClick={() => onChange(parseNormalRangeStr(normalRangeStr, 'bracket'))}
                    className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                  >
                    Create Bracket Range
                  </button>`;
code = code.replace(oldCreateBracket, newCreateBracket);

const oldSelectType = `            <select
              value={range.type}
              onChange={e => {
                if (e.target.value === 'simple') onChange(defaultSimpleRange);
                else onChange(defaultBracketRange);
              }}
              className="text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1"
            >`;
const newSelectType = `            <select
              value={range.type}
              onChange={e => {
                if (e.target.value === 'simple') onChange(parseNormalRangeStr(normalRangeStr, 'simple'));
                else onChange(parseNormalRangeStr(normalRangeStr, 'bracket'));
              }}
              className="text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1"
            >`;
code = code.replace(oldSelectType, newSelectType);

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched range builder");
