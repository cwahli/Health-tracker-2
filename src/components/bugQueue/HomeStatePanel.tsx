import React from 'react';

export type HomeTile = {
  key: string;
  label?: string;
  value?: string | number;
  unit?: string;
};

export type HomeStatePanelProps = {
  surface: 'food' | 'home' | 'health' | 'other';
  tiles?: HomeTile[];
  tombstones?: Record<string, number | string>;
  className?: string;
};

/**
 * HomeStatePanel — pack shell for home surface (Q-6.4 G0-3).
 * Renders home dashboard tiles and tombstone table.
 * NO scout identity or meal tape.
 * Hides completely when surface !== 'home'.
 */
export const HomeStatePanel: React.FC<HomeStatePanelProps> = ({
  surface,
  tiles = [],
  tombstones = {},
  className = '',
}) => {
  if (surface !== 'home') {
    return null;
  }

  const tombstoneEntries = Object.entries(tombstones || {});

  return (
    <div className={`space-y-3 ${className}`} data-testid="home-state-panel">
      {/* Home State Overview / Tiles */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Home State Tiles ({tiles.length})
        </div>

        {tiles.length === 0 ? (
          <p className="text-[11px] text-white/50 italic">No live tiles active on home state.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tiles.map((tile) => (
              <div
                key={tile.key}
                className="bg-black/40 border border-white/10 rounded-lg p-2 space-y-0.5"
              >
                <span className="text-[10px] text-slate-400 block truncate">
                  {tile.label || tile.key}
                </span>
                <span className="text-xs font-bold text-white block truncate">
                  {tile.value ?? '—'} {tile.unit || ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tombstones Table */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
          Tombstones Registry ({tombstoneEntries.length})
        </div>

        {tombstoneEntries.length === 0 ? (
          <p className="text-[11px] text-white/50 italic">No tombstones registered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                  <th className="py-1 px-1.5">Tombstone Key</th>
                  <th className="py-1 px-1.5 text-right">Deleted At / Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-[10px]">
                {tombstoneEntries.map(([key, timestamp]) => (
                  <tr key={key} className="hover:bg-white/5">
                    <td className="py-1 px-1.5 text-amber-200">{key}</td>
                    <td className="py-1 px-1.5 text-right text-slate-400">
                      {String(timestamp)}
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
