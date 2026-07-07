const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const targetState = `  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState<boolean>(false);`;
const replacementState = `  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState<boolean>(false);
  const [isTargetsExpanded, setIsTargetsExpanded] = React.useState<boolean>(false);`;
code = code.replace(targetState, replacementState);

const targetModalScroll = `          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">`;
const replacementModalScroll = `          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">`;
code = code.replace(targetModalScroll, replacementModalScroll);

const targetSection = `              {/* Targets Section */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-3">
                <div className="flex justify-between text-xs font-bold text-slate-850 dark:text-slate-250">
                  <span>Targets</span>
                </div>
                <div className="grid grid-cols-2 gap-3">`;
const replacementSection = `              {/* Targets Section */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-3">
                <button
                  onClick={() => setIsTargetsExpanded(!isTargetsExpanded)}
                  className="flex items-center justify-between w-full text-xs font-bold text-slate-850 dark:text-slate-250 cursor-pointer"
                >
                  <span>Manual Targets Override</span>
                  <ChevronDown className={\`w-4 h-4 transition-transform \${isTargetsExpanded ? 'rotate-180' : ''}\`} />
                </button>
                {isTargetsExpanded && (
                  <div className="grid grid-cols-2 gap-3 pt-2">`;
code = code.replace(targetSection, replacementSection);

const targetSectionEnd = `                    />
                  </div>
                </div>
              </div>
              
              {/* View Timeframe Selection */}`;
const replacementSectionEnd = `                    />
                  </div>
                </div>
                )}
              </div>
              
              {/* View Timeframe Selection */}`;
code = code.replace(targetSectionEnd, replacementSectionEnd);

fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched");
