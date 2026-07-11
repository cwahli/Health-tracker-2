const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetStr = `                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recommended Name</label>
                            <input
                              type="text"`;

const newStr = `                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recommended Name</label>
                            <input
                              type="text"`;

const endOfGrid = `                            />
                          </div>
                        </div>`;

const newGrid = `                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Unit</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.unit !== undefined ? edits.unit : ''}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: { ...edits, unit: e.target.value }
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Normal Range</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.normalRange !== undefined ? edits.normalRange : ''}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: { ...edits, normalRange: e.target.value }
                                });
                              }}
                            />
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Description</label>
                          <textarea
                            className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                            value={edits.description !== undefined ? edits.description : ''}
                            onChange={(e) => {
                              setGroupEdits({
                                ...groupEdits,
                                [groupIdx]: { ...edits, description: e.target.value }
                              });
                            }}
                          />
                        </div>`;

if (code.includes(endOfGrid)) {
  code = code.replace(endOfGrid, newGrid);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log("Fixed UI");
} else {
  console.log("Could not find end of grid");
}
