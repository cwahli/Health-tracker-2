const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const targetCard = `      {/* Single Most Important Next Step */}
      <div id="primary-action-card" className="p-2">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {t.singleNextStep}
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
              {getDynamicNextStep()}
            </p>
            {!report && getMissingDataStatus().length > 0 && (
              <button
                id="home-navigate-medical-btn"
                onClick={() => onNavigateToTab('medical')}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 mt-2 block cursor-pointer"
              >
                Add body information &rarr;
              </button>
            )}
            {!report && getMissingDataStatus().length === 0 && (
              <button
                onClick={() => onNavigateToTab('insights')}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 mt-2 block cursor-pointer"
              >
                Run Health Analysis &rarr;
              </button>
            )}
          </div>
        </div>
      </div>`;

const replacementCard = `      {/* Daily Recommendation */}
      <div id="primary-action-card" className="p-2">
        <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 shadow-sm">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              Daily Recommendation
            </h3>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              Get personalized insights on your progress and today's goals.
            </p>
          </div>
          <button
            onClick={() => setIsDailyRecommendationChatOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
          >
            What's up today?
          </button>
        </div>
      </div>`;

code = code.replace(targetCard, replacementCard);

fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched card");
