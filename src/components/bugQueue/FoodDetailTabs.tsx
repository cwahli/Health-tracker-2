import React from 'react';
import { PHASE_LABEL, groupJourneyByDish } from '../../utils/goldenScoreboard';

export type FoodDetailTabsProps = {
  activeTab: 'checks' | 'dishes' | 'scout' | 'balance' | 'history';
  onTabChange: (tab: 'checks' | 'dishes' | 'scout' | 'balance' | 'history') => void;
  board?: any;
  goldenLines?: any[];
  onAddDish?: () => void;
  className?: string;
};

/**
 * FoodDetailTabs — 5-tab navigation strip for food cards on BugTrackerModal (Q-6.4 G1-4).
 * Tabs: Checks · Dishes · Scout identity · Balance · History
 * (History renders the primary tracker commits timeline in parent).
 */
export const FoodDetailTabs: React.FC<FoodDetailTabsProps> = ({
  activeTab,
  onTabChange,
  board,
  goldenLines = [],
  onAddDish,
  className = '',
}) => {
  const journey = Array.isArray(board?.journey) ? board.journey : [];
  const invariants = Array.isArray(board?.invariants) ? board.invariants : [];
  const ledger = board?.ledger;

  return (
    <div className={`space-y-3 ${className}`} data-testid="food-detail-tabs">
      {/* 5-Tab Navigation Strip */}
      <div className="flex rounded-xl bg-slate-950 p-1 border border-white/15 gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => onTabChange('history')}
          className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          History
        </button>
        <button
          type="button"
          onClick={() => onTabChange('checks')}
          className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            activeTab === 'checks'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          Checks
        </button>
        <button
          type="button"
          onClick={() => onTabChange('dishes')}
          className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            activeTab === 'dishes'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          Dishes
        </button>
        <button
          type="button"
          onClick={() => onTabChange('scout')}
          className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            activeTab === 'scout'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          Scout identity
        </button>
        <button
          type="button"
          onClick={() => onTabChange('balance')}
          className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            activeTab === 'balance'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          Balance
        </button>
      </div>

      {/* Pane: Checks */}
      {activeTab === 'checks' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
              Journey Checks & Invariants ({invariants.length})
            </span>
          </div>

          {invariants.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No invariant checks recorded on this meal tape.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {invariants.map((inv: any, idx: number) => {
                const isPass = inv.status === 'pass';
                return (
                  <div
                    key={inv.id || idx}
                    className={`flex items-start justify-between gap-2 p-2 rounded-lg border text-[11px] ${
                      isPass
                        ? 'bg-emerald-950/30 border-emerald-500/20 text-emerald-100'
                        : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                    }`}
                  >
                    <span className="leading-snug">{inv.label || inv.id}</span>
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                        isPass ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'
                      }`}
                    >
                      {inv.status || 'fail'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pane: Dishes */}
      {activeTab === 'dishes' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
              Top Dishes Target Values ({goldenLines.length})
            </span>
            {onAddDish && (
              <button
                type="button"
                onClick={onAddDish}
                className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
              >
                + Add Dish
              </button>
            )}
          </div>

          {goldenLines.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No target dishes defined for this meal.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                    <th className="py-1 px-2 text-left w-6">✓</th>
                    <th className="py-1 px-2 text-left">Dish</th>
                    <th className="py-1 px-2 text-right">kcal</th>
                    <th className="py-1 px-2 text-right">g</th>
                    <th className="py-1 px-2 text-right">P</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {goldenLines.map((line: any, idx: number) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="py-1 px-2 text-emerald-400 font-bold">
                        {line.scored !== false ? '✓' : ''}
                      </td>
                      <td className="py-1 px-2 font-medium text-white">{line.name}</td>
                      <td className="py-1 px-2 text-right text-amber-200">{line.calories ?? '—'}</td>
                      <td className="py-1 px-2 text-right text-emerald-200">{line.weightGrams ?? '—'}</td>
                      <td className="py-1 px-2 text-right text-blue-200">{line.protein ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pane: Scout identity */}
      {activeTab === 'scout' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
            Scout Journey — {journey.filter((j: any) => j.identityPass).length}/{journey.length} identified
          </div>

          {journey.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No scout journey items available.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {groupJourneyByDish(journey).map((g) => (
                <div key={g.dish} className="space-y-0.5">
                  <p className="text-[11px] font-bold text-indigo-200">{g.dish}</p>
                  <div className="space-y-0.5 pl-2">
                    {g.rows.map((j: any) => (
                      <div
                        key={j.id}
                        className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/5 last:border-0"
                      >
                        <span className="text-white/80">{j.query}</span>
                        <span
                          className={`text-[10px] font-bold ${
                            j.identityPass ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {PHASE_LABEL[j.phase as keyof typeof PHASE_LABEL] || j.phase}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pane: Balance */}
      {activeTab === 'balance' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-violet-300">
              Meal Journey / Trial Balance
            </span>
            {ledger && (
              <span
                className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
                  ledger.compiler === 'green'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {ledger.compiler === 'green' ? 'balanced' : 'unbalanced'}
              </span>
            )}
          </div>

          {!ledger ? (
            <p className="text-[11px] text-white/50 italic">No ledger compile data available for this meal.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(ledger.books || []).map((b: any) => (
                  <div key={b.id} className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-[10px]">
                    <p className="text-white/50">{b.label?.replace(/ \(.*/, '')}</p>
                    <p className="font-bold text-white text-xs">{b.kcal == null ? '—' : `${b.kcal} kcal`}</p>
                  </div>
                ))}
              </div>

              {(ledger.imbalances || []).length > 0 && (
                <div className="space-y-1 bg-rose-950/30 p-2 rounded-lg border border-rose-500/30">
                  {ledger.imbalances.map((imb: any) => (
                    <p key={imb.id} className="text-[10px] text-rose-200">
                      <strong>{imb.signal}:</strong> {imb.label}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
