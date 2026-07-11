const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `      /></ErrorBoundary>
    </div>
  );
}`;

const insertStr = `      />

      {/* Undo/Snapshot button \u2014 shown when at least one snapshot exists */}
      {snapshots.length > 0 && (
        <button
          onClick={() => setShowSnapshotPanel(true)}
          className="fixed bottom-28 left-4 z-40 flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          title="Restore a previous snapshot"
        >
          <span>\u21A9</span> Undo
        </button>
      )}

      {/* Snapshot/Undo Panel */}
      {showSnapshotPanel && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50" onClick={() => setShowSnapshotPanel(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl w-full max-w-lg p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>\uD83D\uDD50</span> Restore a Snapshot
              </h2>
              <button onClick={() => setShowSnapshotPanel(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            {snapshots.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No snapshots yet. Snapshots are created automatically before each agent approval.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {snapshots.map((snap: any) => (
                  <div key={snap.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{snap.label}</p>
                      <p className="text-[10px] text-slate-400">{new Date(snap.timestamp).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {snap.data?.biomarkerHistory?.length ?? 0} biomarker logs \u00B7 {snap.data?.foodLogs?.length ?? 0} food logs
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => {
                          deleteLocalSnapshot(profile?.email, snap.id);
                          setSnapshots(loadLocalSnapshots(profile?.email));
                        }}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 text-center mt-4">Snapshots are stored locally on this device only. Up to 5 are kept.</p>
          </div>
        </div>
      )}

      </ErrorBoundary>
    </div>
  );
}`;

code = code.replace(targetStr, insertStr);
fs.writeFileSync('src/App.tsx', code);
