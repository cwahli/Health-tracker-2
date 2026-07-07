const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const target = `                  <div className="space-y-1">
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
              </div>`;

const extra = `                  <div className="space-y-1">
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
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Carbs (g)</label>
                    <input 
                      type="number"
                      value={report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.carbohydrates, 200) : 200}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, carbohydrates: \`\${e.target.value} g\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500">Total Fat (g)</label>
                    <input 
                      type="number"
                      value={report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.totalFat, 60) : 60}
                      onChange={(e) => {
                         if (onUpdateReport && report) {
                           onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, totalFat: \`\${e.target.value} g\`}})
                         }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                    />
                  </div>
                </div>
              </div>`;

code = code.replace(target, extra);
fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched more targets");
