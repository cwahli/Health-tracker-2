const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /              \{\/\* Chat Input \*\/\}\n              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">\n                <div className="relative flex items-center gap-2">\n                  <button\n                    type="button"\n                    onClick=\{\(\) => handleRunConsolidationAgent\(true\)\}\n                    disabled=\{consolidationLoading \|\| selectedKeys\.length === 0\}\n                    className="p-3 rounded-xl bg-violet-100 dark:bg-violet-900\/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900\/50 transition-colors disabled:opacity-50"\n                    title="Run Auto-Consolidation without text"\n                  >\n                    <BrainCircuit className="w-5 h-5" \/>\n                  <\/button>\n                  <div className="relative flex-1">\n                    <input\n                      type="text"\n                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-4 pr-12 py-3 text-\[13px\] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500\/50 focus:border-indigo-500"\n                      placeholder="Ask the agent to group specific items or just click the magic button\.\.\."\n                      value=\{consolidationInput\}\n                      onChange=\{e => setConsolidationInput\(e\.target\.value\)\}\n                      onKeyDown=\{e => e\.key === 'Enter' && handleRunConsolidationAgent\(\)\}\n                      disabled=\{consolidationLoading\}\n                    \/>\n                    <button\n                      type="button"\n                      onClick=\{\(\) => handleRunConsolidationAgent\(\)\}\n                      disabled=\{consolidationLoading \|\| \(\!consolidationInput\.trim\(\) && selectedKeys\.length === 0\)\}\n                      className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"\n                    >\n                      <Send className="w-4 h-4" \/>\n                    <\/button>\n                  <\/div>\n                <\/div>\n              <\/div>/g;

const newText = `              {/* Chat Input */}
              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-col gap-2">
                  <div className="relative w-full">
                    <input
                      type="text"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-4 pr-12 py-3 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                      placeholder="Ask the agent to group specific items or hit Start..."
                      value={consolidationInput}
                      onChange={e => setConsolidationInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRunConsolidationAgent()}
                      disabled={consolidationLoading}
                    />
                    <button
                      type="button"
                      onClick={() => handleRunConsolidationAgent()}
                      disabled={consolidationLoading || (!consolidationInput.trim() && selectedKeys.length === 0)}
                      className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRunConsolidationAgent(true)}
                    disabled={consolidationLoading || selectedKeys.length === 0}
                    className="w-full py-2.5 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <BrainCircuit className="w-4 h-4" />
                    Start
                  </button>
                </div>
              </div>`;

if (code.match(regex)) {
  code = code.replace(regex, newText);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed UI');
} else {
  console.log('Regex did not match');
}
