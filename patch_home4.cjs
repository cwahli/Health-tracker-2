const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const target1 = `                    <p className="text-[10px] text-indigo-900/70 dark:text-indigo-300/70">
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
                    </div>`;

const replacement1 = `                    <div className="grid grid-cols-1 gap-1.5 text-[10px] font-mono">
                      <div className="flex flex-col">
                        <span className="font-bold">Calories:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({calBD.totalPrevIntake} kcal / {calBD.numPrevDays} days) ± {rollingAllowance}% allowance = {calBD.adjustedValue} kcal</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Protein:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({proBD.totalPrevIntake} g / {proBD.numPrevDays} days) ± {rollingAllowance}% allowance = {proBD.adjustedValue} g</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Sat. Fat:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({fatBD.totalPrevIntake} g / {fatBD.numPrevDays} days) ± {rollingAllowance}% allowance = {fatBD.adjustedValue} g</span>
                      </div>
                    </div>`;

code = code.replace(target1, replacement1);
fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched explanation format");
