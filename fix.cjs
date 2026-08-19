const fs = require('fs');
const content = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const broken = `                    <MessageSquare className="w-3.5 h-3.5" />
                    Route Selected
                  </button>
                      <button
                        onClick={() => {`;

const fixed = `                    <MessageSquare className="w-3.5 h-3.5" />
                    Route Selected
                  </button>
                  {showDeleteSelectedConfirm ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/40 rounded-lg p-1.5 shrink-0">
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1">Delete {selectedKeys.length} items?</span>
                      <button
                        onClick={() => {`;

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', content.replace(broken, fixed));
