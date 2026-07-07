const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  `                      <div className="col-span-1 flex justify-end">
                        <button`,
  `                      <div className="col-span-1 flex items-center justify-center">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={r.isNormal || false} onChange={e => {
                            const newRanges = [...editState.structuredRanges];
                            newRanges[idx].isNormal = e.target.checked;
                            setEditState({...editState, structuredRanges: newRanges});
                          }} />
                          <span className="text-[8px] text-slate-400">Normal</span>
                        </label>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button`
);

code = code.replace(
  '<div className="col-span-4 grid grid-cols-2 gap-1">',
  '<div className="col-span-3 grid grid-cols-2 gap-1">' // Adjusting col-span since we added one col-span-1
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched isNormal UI");
