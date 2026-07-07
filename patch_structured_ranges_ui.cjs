const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const structuredRangesUI = `
                <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Structured / Custom Ranges</label>
                    <button
                      type="button"
                      onClick={() => {
                        const newRange = {
                          id: Date.now().toString(),
                          name: '',
                          min: '',
                          max: '',
                          isNormal: false
                        };
                        setEditState({
                          ...editState,
                          structuredRanges: [...(editState.structuredRanges || []), newRange]
                        });
                      }}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                    >
                      + Add Range Bracket
                    </button>
                  </div>
                  {(!editState.structuredRanges || editState.structuredRanges.length === 0) && (
                    <div className="text-xs text-slate-400 italic">No structured ranges defined. Using simple text range.</div>
                  )}
                  {editState.structuredRanges?.map((r: any, idx: number) => (
                    <div key={r.id || idx} className="grid grid-cols-12 gap-2 mb-2 items-center bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800 rounded">
                      <div className="col-span-3">
                        <input
                          type="text"
                          placeholder="Name (e.g. Obese)"
                          className="w-full text-xs bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
                          value={r.name}
                          onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].name = e.target.value;
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">Min</span>
                        <input
                          type="number"
                          className="w-full text-xs bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
                          value={r.min}
                          onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].min = e.target.value === '' ? '' : Number(e.target.value);
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">Max</span>
                        <input
                          type="number"
                          className="w-full text-xs bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
                          value={r.max}
                          onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].max = e.target.value === '' ? '' : Number(e.target.value);
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                        />
                      </div>
                      <div className="col-span-4 grid grid-cols-2 gap-1">
                        <input
                          type="text"
                          placeholder="Target Gender"
                          className="w-full text-[10px] bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none"
                          value={r.targetGender || ''}
                          onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].targetGender = e.target.value;
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Target Ethnicity"
                          className="w-full text-[10px] bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none"
                          value={r.targetEthnicity || ''}
                          onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].targetEthnicity = e.target.value;
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges.splice(idx, 1);
                            setEditState({...editState, structuredRanges: newRanges});
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
`;

code = code.replace(
  '                  </div>\n                </div>\n\n                <div>\n                  <label className="block text-[10px] font-bold',
  '                  </div>\n                </div>\n' + structuredRangesUI + '\n                <div>\n                  <label className="block text-[10px] font-bold'
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched structuredRanges UI");
