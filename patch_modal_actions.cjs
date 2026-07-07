const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// Add the state variable
code = code.replace(
  'const [showCombineModal, setShowCombineModal] = useState(false);',
  'const [showCombineModal, setShowCombineModal] = useState(false);\n  const [showCleaningDropdown, setShowCleaningDropdown] = useState(false);\n  const [isMedicalCategorisationMode, setIsMedicalCategorisationMode] = useState(false);'
);

// Add the button replacements
const targetBtnContainer = `{selectedKeys.length > 0 && (
                <div className="flex items-center gap-2 animation-fade-in">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{selectedKeys.length} selected</span>
                  <button`;

const newBtnContainer = `{selectedKeys.length > 0 && (
                <div className="flex items-center gap-2 animation-fade-in overflow-x-auto pb-2 -mx-2 px-2 hide-scrollbar w-full">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 shrink-0">{selectedKeys.length} selected</span>
                  <button`;

code = code.replace(targetBtnContainer, newBtnContainer);

const stdUnitBtn = `<button
                    onClick={() => {
                      setIsAgentMode(true);
                      setStandardizationYaml(null);
                      setStandardizationSummary(null);
                    }}
                    className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md shadow-indigo-600/10 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    Standardize Units Agent
                  </button>`;

const dropdownReplacement = `<div className="relative shrink-0">
                    <button
                      onClick={() => setShowCleaningDropdown(!showCleaningDropdown)}
                      className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md shadow-indigo-600/10 cursor-pointer whitespace-nowrap"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      Cleaning Agent
                      <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                    </button>
                    {showCleaningDropdown && (
                      <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1.5 min-w-[220px] z-[100] animate-in fade-in slide-in-from-top-2">
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(false);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Standardize Units Agent
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(true);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Medical Categorisation Agent
                        </button>
                      </div>
                    )}
                  </div>`;

code = code.replace(stdUnitBtn, dropdownReplacement);

// We must also ensure shrink-0 is on all other buttons in that container so they don't squish
code = code.replace(/className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700/g, 'className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700');
code = code.replace(/className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50/g, 'className="shrink-0 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50');
code = code.replace(/className="px-3 py-1.5 bg-rose-50/g, 'className="shrink-0 px-3 py-1.5 bg-rose-50');
code = code.replace(/className="px-2 py-1.5 text-slate-400/g, 'className="shrink-0 px-2 py-1.5 text-slate-400');

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal buttons");
