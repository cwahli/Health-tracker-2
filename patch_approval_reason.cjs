const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  'allGroupings?: string[]; allRisks?: string[]; allConditions?: string[]; itemLogs?: { date: string; value: number | string }[];',
  'allGroupings?: string[]; allRisks?: string[]; allConditions?: string[]; itemLogs?: { date: string; value: number | string }[]; approvalReason?: string;'
);

code = code.replace(
  'allGroupings = [], allRisks = [], allConditions = [], itemLogs = []',
  'allGroupings = [], allRisks = [], allConditions = [], itemLogs = [], approvalReason'
);

code = code.replace(
  '                  <button onClick={() => setIsEditing(true)} className="text-slate-400 hover:text-indigo-500 cursor-pointer p-1">',
  `                  {approvalReason && (
                    <div className="absolute top-10 left-3 right-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[10px] p-2 rounded flex items-start gap-1 mt-1 mb-2">
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{approvalReason}</span>
                    </div>
                  )}
                  <button onClick={() => setIsEditing(true)} className="text-slate-400 hover:text-indigo-500 cursor-pointer p-1">`
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched approvalReason UI");
