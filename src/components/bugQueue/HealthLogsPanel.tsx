import React from 'react';

export type HealthLogEntry = {
  id?: string;
  key: string;
  name?: string;
  value?: string | number;
  unit?: string;
  date?: string;
};

export type HealthLogsPanelProps = {
  surface: 'food' | 'home' | 'health' | 'other';
  keys?: string[];
  historyCount?: number;
  ingestJobId?: string | null;
  logs?: HealthLogEntry[];
  className?: string;
};

/**
 * HealthLogsPanel — pack shell for health surface (Q-6.4 G0-3).
 * Renders biomarker history, registered keys, and ingest job metadata.
 * NO meal tape or food scout.
 * Hides completely when surface !== 'health'.
 */
export const HealthLogsPanel: React.FC<HealthLogsPanelProps> = ({
  surface,
  keys = [],
  historyCount = 0,
  ingestJobId = null,
  logs = [],
  className = '',
}) => {
  if (surface !== 'health') {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`} data-testid="health-logs-panel">
      {/* Health Ingest / Job Status */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
            Health Ingest Status
          </div>
          {ingestJobId && (
            <span className="font-mono text-[10px] bg-black/50 text-indigo-200 px-1.5 py-0.5 rounded">
              Job: {ingestJobId}
            </span>
          )}
        </div>

        <p className="text-[11px] text-slate-300">
          Total history logs tracked: <strong className="text-white">{historyCount || logs.length}</strong>
        </p>

        {keys && keys.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] font-extrabold uppercase text-slate-400">
              Active Biomarker Keys ({keys.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {keys.map((k) => (
                <span
                  key={k}
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-black/40 border border-white/10 text-indigo-200"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* History Log Table */}
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Recent Health Logs
        </div>

        {logs.length === 0 ? (
          <p className="text-[11px] text-white/50 italic">No health log entries loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                  <th className="py-1 px-1.5">Date</th>
                  <th className="py-1 px-1.5">Key</th>
                  <th className="py-1 px-1.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log, idx) => (
                  <tr key={log.id || idx} className="hover:bg-white/5">
                    <td className="py-1 px-1.5 text-slate-400">{log.date || '—'}</td>
                    <td className="py-1 px-1.5 font-medium text-white">{log.name || log.key}</td>
                    <td className="py-1 px-1.5 text-right font-mono text-indigo-300">
                      {log.value ?? '—'} {log.unit || ''}
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
