import React from 'react';

export type FoodTapeDish = {
  name: string;
  kcal?: number | string;
  weightGrams?: number | string;
  protein?: number | string;
  score?: boolean;
};

export type FoodTapeIdentityComponent = {
  name: string;
  source?: string;
  matchType?: 'hit' | 'miss' | 'catalog' | 'fallback' | 'USDA' | string;
};

export type FoodTapeIdentityDish = {
  dish: string;
  components: FoodTapeIdentityComponent[];
};

export type FoodTapePanelProps = {
  surface: 'food' | 'home' | 'health' | 'other';
  dishes?: FoodTapeDish[];
  identity?: FoodTapeIdentityDish[];
  onAddDish?: () => void;
  className?: string;
};

/**
 * FoodTapePanel — pack shell for food surface (Q-6.4 G0-3).
 * Renders scout identity list, top dishes table, and Add dish trigger.
 * Hides completely when surface !== 'food'.
 */
export const FoodTapePanel: React.FC<FoodTapePanelProps> = ({
  surface,
  dishes = [],
  identity = [],
  onAddDish,
  className = '',
}) => {
  if (surface !== 'food') {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`} data-testid="food-tape-panel">
      {/* Scout Identity Section */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Scout identity — {identity.reduce((acc, d) => acc + (d.components?.length || 0), 0)} items identified
        </div>

        {identity.length === 0 ? (
          <p className="text-[11px] text-white/50 italic">No scout identity items loaded.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {identity.map((d, dIdx) => (
              <div key={dIdx} className="space-y-1">
                <p className="text-[11px] font-bold text-indigo-300">{d.dish}</p>
                <div className="space-y-0.5 pl-2">
                  {d.components.map((c, cIdx) => {
                    const isHit =
                      c.matchType === 'hit' ||
                      c.matchType === 'catalog' ||
                      c.matchType === 'USDA';
                    return (
                      <div
                        key={cIdx}
                        className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/5 last:border-0"
                      >
                        <span className="text-white/80">{c.name}</span>
                        <span
                          className={`text-[10px] font-bold ${
                            isHit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {c.source || c.matchType || 'scouted'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Dishes Section */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Top dishes — target values
          </div>
          {onAddDish && (
            <button
              type="button"
              onClick={onAddDish}
              className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
            >
              + Add dish
            </button>
          )}
        </div>

        {dishes.length === 0 ? (
          <p className="text-[11px] text-white/50 italic">No dishes in target checklist.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                  <th className="py-1 px-1.5 w-6">✓</th>
                  <th className="py-1 px-1.5">Dish</th>
                  <th className="py-1 px-1.5 text-right">kcal</th>
                  <th className="py-1 px-1.5 text-right">g</th>
                  <th className="py-1 px-1.5 text-right">P</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dishes.map((dish, idx) => (
                  <tr key={idx} className="hover:bg-white/5">
                    <td className="py-1 px-1.5 text-emerald-400 font-bold">
                      {dish.score !== false ? '✓' : ''}
                    </td>
                    <td className="py-1 px-1.5 font-medium text-white">{dish.name}</td>
                    <td className="py-1 px-1.5 text-right text-slate-300">
                      {dish.kcal ?? '—'}
                    </td>
                    <td className="py-1 px-1.5 text-right text-slate-300">
                      {dish.weightGrams ?? '—'}
                    </td>
                    <td className="py-1 px-1.5 text-right text-slate-300">
                      {dish.protein ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
