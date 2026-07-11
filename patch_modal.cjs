const fs = require('fs');
let code = fs.readFileSync('src/components/ConflictResolutionModal.tsx', 'utf-8');

function replaceBlock(typeStr, logsVar, title, source, type) {
  const regex = new RegExp(
    `<span className="text-\\[11px\\] font-bold text-slate-400 uppercase block">Last logged entries:</span>\\s*\\{${logsVar}\\.length === 0 \\? \\([\\s\\S]*?\\) \\: \\([\\s\\S]*?\\)\\)\\s*\\}`,
    'm'
  );
  
  const replacer = `<div className="flex items-center justify-between"><span className="text-[11px] font-bold text-slate-400 uppercase block">Last logged entries:</span><button type="button" onClick={(e) => { e.stopPropagation(); setExpandedView({ title: '${title}', logs: ${source}, type: '${type}' }); }} className="text-[10px] text-indigo-500 hover:text-indigo-600 font-bold uppercase tracking-wider underline">View All</button></div>
                    {${logsVar}.length === 0 ? (
                      <span className="text-xs text-slate-400 block italic">No ${type === 'bio' ? 'history' : 'food'} logged</span>
                    ) : (
                      ${logsVar}.map((log, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/50 pb-1">
                          <span>{log.date}</span>
                          ${type === 'bio' 
                            ? `<span className="font-mono text-slate-700 dark:text-slate-300">{Object.keys(log.biomarkers || {}).length} markers ({Object.keys(log.biomarkers || {}).slice(0, 2).join(', ')}...)</span>`
                            : `<span className="truncate max-w-[150px] font-semibold text-slate-700 dark:text-slate-300">{log.name}</span><span>{log.nutrients?.calories || 0} kcal</span>`
                          }
                        </div>
                      ))
                    )}`;
  
  code = code.replace(regex, replacer);
}

replaceBlock('localBio', 'last3LocalBio', 'Local Device - Biomarkers', 'localBioHistory', 'bio');
replaceBlock('cloudBio', 'last3CloudBio', 'Cloud Database - Biomarkers', 'cloudBioHistory', 'bio');
replaceBlock('localFood', 'last3LocalFoods', 'Local Device - Food & Nutrient History', 'localFoods', 'food');
replaceBlock('cloudFood', 'last3CloudFoods', 'Cloud Database - Food & Nutrient History', 'cloudFoods', 'food');

fs.writeFileSync('src/components/ConflictResolutionModal.tsx', code);
