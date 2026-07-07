const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldButtons = `      {!range ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(defaultSimpleRange)}
            className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
          >
            Create Simple Range
          </button>
          <button
            type="button"
            onClick={() => onChange(defaultBracketRange)}
            className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
          >
            Create Bracket Range
          </button>
        </div>
      ) : (`;

const newButtons = `      {!range ? (
        <div className="flex gap-2">
          {normalRangeStr && normalRangeStr.trim().length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const str = normalRangeStr.trim();
                let type = 'simple';
                if (str.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/)) type = 'bracket';
                onChange(parseNormalRangeStr(normalRangeStr, type as 'simple' | 'bracket'));
              }}
              className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 text-indigo-600 dark:text-indigo-400"
            >
              Edit Range Configuration
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange(defaultSimpleRange)}
                className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
              >
                Create Simple Range
              </button>
              <button
                type="button"
                onClick={() => onChange(defaultBracketRange)}
                className="flex-1 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
              >
                Create Bracket Range
              </button>
            </>
          )}
        </div>
      ) : (`;

code = code.replace(oldButtons, newButtons);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched buttons 2");
