const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const target1 = `              {/* View Timeframe Selection */}`;

const newSection = `              {/* Targets Section */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-3">
                <div className="flex justify-between text-xs font-bold text-slate-850 dark:text-slate-250">
                  <span>Targets</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Calories (kcal)</label>
                    <input 
                      type="number"
                      value={baseCaloriesTarget}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, calories: \`\${e.target.value} kcal\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Protein (g)</label>
                    <input 
                      type="number"
                      value={baseProteinTarget}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, protein: \`\${e.target.value} g\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Sat. Fat (g)</label>
                    <input 
                      type="number"
                      value={baseSatFatTarget}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, saturatedFat: \`\${e.target.value} g\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Sodium (mg)</label>
                    <input 
                      type="number"
                      value={baseSodiumTarget}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, sodium: \`\${e.target.value} mg\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Steps</label>
                    <input 
                      type="number"
                      value={report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.steps, 3000) : 3000}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, steps: \`\${e.target.value} steps\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                </div>
              </div>
              
              {/* View Timeframe Selection */}`;

code = code.replace(target1, newSection);
fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched targets");
