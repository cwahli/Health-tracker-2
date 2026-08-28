import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `{catalogMatches.length > 0 && (`;
const idx = code.indexOf(targetStr);
const endIdx = code.indexOf(`{isCompressing && (`, idx);

if (idx !== -1 && endIdx !== -1) {
  const replacement = `
          {(() => {
            const combinedMatches = [
              ...catalogMatches.map(m => ({ ...m, _listType: 'brand' })),
              ...matchingPreviousLogs.map(m => ({ ...m, _listType: 'previous_meal' }))
            ];
            
            if (combinedMatches.length === 0) return null;
            return (
              <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-white dark:bg-slate-800 border border-theme-border/80 rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto z-50 animate-fade-in font-sans">
                <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                  <span className="text-[11px] font-bold text-theme-text-secondary">Matches</span>
                  <span className="text-[9px] text-slate-400">Click Add to inline</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {combinedMatches.map((item, idx) => (
                    <div key={item._listType === 'brand' ? (item.food_id || idx) : item.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {item._listType === 'previous_meal' && (
                          (item.imageUrl || (item.imageUrls && item.imageUrls.length > 0)) ? (
                            <img 
                              src={resolveFoodImage(item.imageUrl || item.imageUrls?.[0], activeFoodLogs)} 
                              alt={item.name} 
                              className="w-8 h-8 rounded-lg object-cover border border-slate-100 dark:border-slate-700 shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 font-bold text-xs shrink-0">
                              {item.name.charAt(0).toUpperCase()}
                            </div>
                          )
                        )}
                        <div className="min-w-0 flex flex-col">
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {item._listType === 'brand' ? item.dish_name : item.name}
                          </div>
                          <div className="text-[10px] text-theme-text-secondary truncate mt-0.5">
                            {item._listType === 'brand' ? item.chain_name : (
                              <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider inline-block mr-1">
                                Previous Meal
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {item._listType === 'brand' && (
                          <>
                            <input 
                              type="number" 
                              defaultValue={tagPortionPreFill}
                              id={\`tag-portion-\${item.food_id}\`}
                              className="w-12 px-1 py-1 text-xs border rounded bg-white dark:bg-slate-700 text-center" 
                            />
                            <span className="text-xs text-slate-500">g</span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (item._listType === 'brand') {
                              const w = (document.getElementById(\`tag-portion-\${item.food_id}\`) as HTMLInputElement)?.value || tagPortionPreFill;
                              setExplicitFoodTags(prev => [...prev, { dbId: item.food_id, name: item.dish_name, weightGrams: Number(w), source: 'catalog_tag' }]);
                              setInputText(prev => prev + \` [\${item.dish_name} \${w}g] \`);
                            } else {
                              setExplicitFoodTags(prev => [...prev, { dbId: item.id, name: item.name, source: 'previous_meal', originalLog: item }]);
                              setInputText(prev => prev + \` [\${item.name}] \`);
                            }
                            setCatalogMatches([]);
                          }}
                          className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          `;

  const newCode = code.slice(0, idx) + replacement + code.slice(endIdx);
  fs.writeFileSync('src/components/LogChat.tsx', newCode);
  console.log("Patched dropdown");
} else {
  console.log("Could not find dropdown block");
}
