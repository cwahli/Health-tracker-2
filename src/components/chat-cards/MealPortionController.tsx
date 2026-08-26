import React from 'react';

interface MealPortionControllerProps {
  displayedScoutItems: any[];
  portionScale: number;
  portionAccepted: boolean;
  onScalePortion: (ratio: number) => void;
  onScaleSingleDish: (dishIdx: number, ratio: number) => void;
  onAcceptPortion: () => void;
  isSaved?: boolean;
}

export function MealPortionController({
  displayedScoutItems,
  portionScale,
  portionAccepted,
  onScalePortion,
  onScaleSingleDish,
  onAcceptPortion,
  isSaved = false,
}: MealPortionControllerProps) {
  const baseMealWeightGrams = displayedScoutItems.reduce(
    (acc: number, it: any) => acc + (Number(it.estimatedWeightGrams) || Number(it.weightGrams) || 0),
    0
  ) || (displayedScoutItems[0]?.totalMealWeightGrams || 0);

  const currentAppliedWeight = Math.round(baseMealWeightGrams * (portionScale || 1.0));
  const hasMultipleDishes = displayedScoutItems.length > 1;

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-lg text-left font-sans backdrop-blur-md">
      {/* Overall Meal Portion Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="text-base mt-0.5">⚖️</span>
          <div>
            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5 flex-wrap">
              <span>Total Meal Portion:</span>
              <span className="text-indigo-400 font-extrabold bg-indigo-950/80 border border-indigo-700/60 px-1.5 py-0.5 rounded text-[11px]">
                {portionScale === 1.0 ? '1 serving' : `${portionScale}x`}{' '}
                {currentAppliedWeight > 0
                  ? `(${currentAppliedWeight}g${hasMultipleDishes ? ` across ${displayedScoutItems.length} dishes` : ''})`
                  : ''}
              </span>
              {portionAccepted && (
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                  ✓ Accepted
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-tight">
              {hasMultipleDishes
                ? `Scale all ${displayedScoutItems.length} dishes together, or adjust each dish individually below:`
                : 'Visual portion estimation applied. Adjust quantity or accept:'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
          {[
            { ratio: 0.5, label: '0.5x' },
            { ratio: 1.0, label: '1.0x' },
            { ratio: 1.5, label: '1.5x' },
            { ratio: 2.0, label: '2.0x' },
          ].map(({ ratio, label }) => {
            const optionWeight = baseMealWeightGrams > 0 ? Math.round(baseMealWeightGrams * ratio) : 0;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => onScalePortion(ratio)}
                className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer flex flex-col items-center min-w-[48px] ${
                  portionScale === ratio
                    ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600'
                }`}
              >
                <span>{label}</span>
                {optionWeight > 0 && <span className="text-[9px] font-normal opacity-80">{optionWeight}g</span>}
              </button>
            );
          })}
          {!portionAccepted && (
            <button
              type="button"
              onClick={onAcceptPortion}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all cursor-pointer ml-1 self-stretch flex items-center justify-center"
            >
              ✓ Accept
            </button>
          )}
        </div>
      </div>

      {/* Per-Dish Portion Selectors (Visible directly on card whenever multiple dishes exist) */}
      {hasMultipleDishes && (
        <div className="mt-3 pt-2.5 border-t border-slate-700/70 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-slate-200">🍽️ Dish Portion Sizing (Individual):</span>
            <span className="text-[10px] text-slate-400">Scale each dish independently</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {displayedScoutItems.map((dish: any, dIdx: number) => {
              const dishRatio = dish.portionRatio || 1.0;
              const dishWeight = Number(dish.weightGrams) || Number(dish.estimatedWeightGrams) || 0;
              const dishBaseWeight = dishRatio > 0 ? Math.round(dishWeight / dishRatio) : dishWeight;
              const dishTitle = dish.originalName || dish.keyword || dish.name || `Dish ${dIdx + 1}`;

              return (
                <div
                  key={dIdx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 rounded-lg border border-slate-700/60 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {dishTitle}
                    </span>
                    <span className="text-[11px] font-bold text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 px-1.5 py-0.2 rounded shrink-0">
                      {dishWeight}g ({dishRatio}x)
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                    {[
                      { ratio: 0.5, label: '0.5x' },
                      { ratio: 1.0, label: '1.0x' },
                      { ratio: 1.5, label: '1.5x' },
                      { ratio: 2.0, label: '2.0x' },
                    ].map(({ ratio, label }) => {
                      const chipWeight = dishBaseWeight > 0 ? Math.round(dishBaseWeight * ratio) : 0;
                      const isSelected = Math.abs(dishRatio - ratio) < 0.05;
                      return (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => onScaleSingleDish(dIdx, ratio)}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600'
                          }`}
                        >
                          <span>{label}</span>
                          {chipWeight > 0 && <span className="text-[9px] font-normal opacity-80">{chipWeight}g</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
