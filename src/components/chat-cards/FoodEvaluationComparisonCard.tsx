import React from 'react';
import { translations } from '../../utils/translations';
import { Check } from 'lucide-react';

interface FoodEvaluationComparisonCardProps {
  language?: string;
  msg: any;
  onLogFood?: (food: any) => void;
}

export const FoodEvaluationComparisonCard: React.FC<FoodEvaluationComparisonCardProps> = ({ msg, language, onLogFood }) => {
  const t = translations[language || "en"] || translations.en;
  const [loggedOptions, setLoggedOptions] = React.useState<Record<number, boolean>>({});

  if (!msg.agentResult || msg.agentResult.mode !== 'evaluation' || !msg.agentResult.comparison) return null;

  return (
    <>
      <div className="bg-white dark:bg-slate-800 border border-theme-border rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-[70%] max-w-full mx-auto min-w-0 overflow-hidden font-sans">
        <div className="flex items-center justify-between border-b border-theme-border/50 pb-2 gap-2">
          <h4 className="font-bold text-theme-text text-sm break-words flex flex-wrap items-center gap-1.5 w-full font-display">
            <span className="shrink-0">{t.comparisonLabel}</span> <span className="text-indigo-600 dark:text-indigo-400 font-bold break-words">{msg.agentResult.comparison.keyNutrientConcern || t.nutrientsOfConcern}</span>
          </h4>
        </div>
        {/* ComparisonSet Options Grid */}
        {(msg.agentResult.comparisonSet?.optionMeals || msg.agentResult.comparison?.options) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {(msg.agentResult.comparisonSet?.optionMeals || msg.agentResult.comparison?.options).map((opt: any, i: number) => {
              const name = opt.content?.name || opt.name || opt.title || `Option ${i + 1}`;
              const protein = Number(opt.nutrients?.protein ?? opt.protein) || 0;
              const carbs = Number(opt.nutrients?.carbohydrates ?? opt.nutrients?.carbs ?? opt.carbohydrates ?? opt.carbs) || 0;
              const fat = Number(opt.nutrients?.totalFat ?? opt.nutrients?.fat ?? opt.totalFat ?? opt.fat) || 0;
              let calories = Number(opt.nutrients?.calories ?? opt.calories) || 0;
              if (calories <= 0 && (protein > 0 || carbs > 0 || fat > 0)) {
                calories = Math.round(4 * protein + 4 * carbs + 9 * fat);
              }
              const rec = opt.content?.recommendation || opt.recommendation || opt.verdict || '';
              const isLogged = loggedOptions[i];

              return (
                <div key={i} className="bg-slate-50 dark:bg-slate-900/60 border border-theme-border p-3 rounded-xl space-y-2 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-xs text-theme-text">
                      <span className="truncate max-w-[140px]" title={name}>{name}</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold shrink-0">{calories} kcal</span>
                    </div>
                    <div className="flex gap-2 text-[10px] text-theme-neutral font-mono font-medium">
                      <span>P: {protein}g</span>
                      <span>C: {carbs}g</span>
                      <span>F: {fat}g</span>
                    </div>
                    {rec && (
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 italic pt-1 border-t border-theme-border/40 leading-snug">
                        "{rec}"
                      </p>
                    )}
                  </div>

                  {onLogFood && (
                    <div className="pt-2 border-t border-theme-border/40 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const foodToLog = {
                            name,
                            title: name,
                            items: opt.items || [],
                            itemsBreakdown: opt.items || [],
                            nutrients: {
                              calories,
                              protein,
                              carbohydrates: carbs,
                              totalFat: fat,
                              ...(opt.nutrients || {})
                            },
                            message: rec,
                            healthImpact: rec,
                            source: 'food_compare',
                            date: new Date().toISOString()
                          };
                          onLogFood(foodToLog);
                          setLoggedOptions(prev => ({ ...prev, [i]: true }));
                        }}
                        disabled={isLogged}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer ${
                          isLogged
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[2.5px]" />
                        <span>{isLogged ? (t.savedToLog || 'Logged') : 'Log Option'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Key Nutrient Comparison Table */}
        {(msg.agentResult.comparison.comparisonTable || msg.agentResult.comparison.comparisonTableJson || msg.agentResult.comparison.comparisonTableMarkdown) && (
          <div className="border border-theme-border rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 mt-2">
            <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-theme-border">
              <span className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider">
                📊 Side-by-Side Comparison Matrix
              </span>
            </div>
            {(msg.agentResult.comparison.comparisonTable || msg.agentResult.comparison.comparisonTableJson) ? (
              <div className="p-0 overflow-x-auto">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-theme-border">
                    <tr>
                      <th className="px-3 py-2.5 font-bold text-theme-text-secondary font-mono text-[10px] tracking-wider uppercase whitespace-nowrap">{t.nutrientLabel}</th>
                      {(msg.agentResult.comparison.foods || []).map((food: any, i: number) => (
                        <th key={i} className="px-3 py-2.5 font-bold text-theme-text-secondary font-mono text-[10px] tracking-wider uppercase whitespace-nowrap">{food.name}</th>
                      ))}
                      <th className="px-3 py-2.5 font-bold text-theme-text-secondary font-mono text-[10px] tracking-wider uppercase whitespace-nowrap">{t.targetLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {((msg.agentResult.comparison.comparisonTable || msg.agentResult.comparison.comparisonTableJson).rows || []).map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 group">
                        <td className="px-3 py-2 whitespace-nowrap font-bold text-theme-text">{row.nutrient}</td>
                        {(row.values || []).map((val: string, vIdx: number) => (
                          <td key={vIdx} className="px-3 py-2 whitespace-nowrap font-medium text-theme-neutral group-hover:text-slate-900 dark:group-hover:text-slate-100">{val}</td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap text-amber-600 dark:text-amber-400 font-bold">{row.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-3 text-[11px] prose dark:prose-invert prose-p:leading-relaxed prose-pre:m-0 prose-pre:bg-transparent overflow-x-auto max-w-none text-theme-neutral">
                {msg.agentResult.comparison.comparisonTableMarkdown}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
