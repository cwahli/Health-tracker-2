import React from 'react';
import { translations } from '../../utils/translations';

interface FoodEvaluationComparisonCardProps {
  language?: string;
  msg: any;
}

export const FoodEvaluationComparisonCard: React.FC<FoodEvaluationComparisonCardProps> = ({ msg, language }) => {
  const t = translations[language || "en"] || translations.en;
  if (!msg.agentResult || msg.agentResult.mode !== 'evaluation' || !msg.agentResult.comparison) return null;

  return (
    <>
      <div className="bg-white dark:bg-slate-800 border border-theme-border rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-[70%] max-w-full mx-auto min-w-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-theme-border/50 pb-2 gap-2">
          <h4 className="font-bold text-theme-text text-sm break-words flex flex-wrap items-center gap-1.5 w-full">
            <span className="shrink-0">{t.comparisonLabel}</span> <span className="text-indigo-600 dark:text-indigo-400 font-bold break-words">{msg.agentResult.comparison.keyNutrientConcern || t.nutrientsOfConcern}</span>
          </h4>
        </div>
        {/* ComparisonSet Options Grid */}
        {(msg.agentResult.comparisonSet?.optionMeals || msg.agentResult.comparison?.options) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {(msg.agentResult.comparisonSet?.optionMeals || msg.agentResult.comparison?.options).map((opt: any, i: number) => {
              const name = opt.content?.name || opt.name || opt.title || `Option ${i + 1}`;
              const calories = opt.nutrients?.calories || opt.calories || 0;
              const protein = opt.nutrients?.protein || opt.protein || 0;
              const carbs = opt.nutrients?.carbohydrates || opt.carbohydrates || opt.carbs || 0;
              const fat = opt.nutrients?.fat || opt.fat || 0;
              const rec = opt.content?.recommendation || opt.recommendation || opt.verdict || '';

              return (
                <div key={i} className="bg-slate-50 dark:bg-slate-900/60 border border-theme-border p-3 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between font-bold text-xs text-theme-text">
                    <span>{name}</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-mono">{calories} kcal</span>
                  </div>
                  <div className="flex gap-2 text-[10px] text-theme-neutral font-mono">
                    <span>P: {protein}g</span>
                    <span>C: {carbs}g</span>
                    <span>F: {fat}g</span>
                  </div>
                  {rec && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 italic pt-1 border-t border-theme-border/40">
                      "{rec}"
                    </p>
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
