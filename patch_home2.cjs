const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const target1 = `            {/* Explanation card */}
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-500/10 rounded-2xl text-xs text-indigo-950 dark:text-indigo-200/90 leading-relaxed space-y-1">
              <span className="font-bold block text-indigo-900 dark:text-indigo-300">How Rolling Budget Works</span>
              <p>
                Adjusts your target today based on your previous days' averages. Over-consuming reduces today's allowance, while under-consuming increases it, up to your authorized limit.
              </p>
            </div>`;

const caloriesBreakdown = `getRollingBreakdown('calories', baseCaloriesTarget)`;
const proteinBreakdown = `getRollingBreakdown('protein', baseProteinTarget)`;
const satFatBreakdown = `getRollingBreakdown('saturatedFat', baseSatFatTarget)`;

const newExp = `            {/* Explanation card */}
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-500/10 rounded-2xl text-xs text-indigo-950 dark:text-indigo-200/90 leading-relaxed space-y-2">
              <span className="font-bold block text-indigo-900 dark:text-indigo-300">How Rolling Budget Works</span>
              {(() => {
                const calBD = getRollingBreakdown('calories', baseCaloriesTarget);
                const proBD = getRollingBreakdown('protein', baseProteinTarget);
                const fatBD = getRollingBreakdown('saturatedFat', baseSatFatTarget);
                
                if (!calBD || !proBD || !fatBD) return <p>Adjusts your target today based on your previous days' averages.</p>;
                
                return (
                  <div className="space-y-2">
                    <p className="text-[10px] text-indigo-900/70 dark:text-indigo-300/70">
                      Formula: Base Target + (Total Previous Target - Total Previous Intake) capped by Maximum Adjustment Limit.
                    </p>
                    <div className="grid grid-cols-1 gap-1 text-[10px] font-mono">
                      <div className="flex justify-between">
                        <span>Calories:</span>
                        <span>{baseCaloriesTarget} + Math.min({calBD.totalPrevTarget} - {calBD.totalPrevIntake}, {calBD.maxAdjustment}) = {calBD.adjustedValue} kcal</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Protein:</span>
                        <span>{baseProteinTarget} + Math.min({proBD.totalPrevTarget} - {proBD.totalPrevIntake}, {proBD.maxAdjustment}) = {proBD.adjustedValue} g</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sat. Fat:</span>
                        <span>{baseSatFatTarget} + Math.min({fatBD.totalPrevTarget} - {fatBD.totalPrevIntake}, {fatBD.maxAdjustment}) = {fatBD.adjustedValue} g</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>`;

code = code.replace(target1, newExp);
fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched explanation");
