const fs = require('fs');
let code = fs.readFileSync('src/components/AllAnalysesModal.tsx', 'utf8');

// 1. Remove the copy text
code = code.replace(
  /<p className="text-xs text-slate-400 truncate max-w-md hidden sm:block">\s*Manage, review, save to history, or re-run all food & medical analyses in full-screen mode\.\s*<\/p>/g,
  ''
);

// 2. Add local state to AnalysisCard
code = code.replace(
  /function AnalysisCard\(\{[\s\S]*?\}\: AnalysisCardProps\) \{/,
  `$&
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);`
);

// 3. Replace the delete button
const deleteBtnRegex = /<button\s*onClick=\{onDelete\}\s*className="p-1\.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"\s*title="Delete analysis task"\s*>\s*<Trash2 className="w-4 h-4" \/>\s*<\/button>/g;

const newDeleteBtn = `{isConfirmingDelete ? (
            <div className="flex items-center gap-1 bg-rose-950/40 rounded-xl px-1 border border-rose-900/50">
              <button
                onClick={onDelete}
                className="px-2 py-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                Confirm
              </button>
              <div className="w-[1px] h-3 bg-rose-900/50" />
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Delete analysis task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}`;

code = code.replace(deleteBtnRegex, newDeleteBtn);

// 4. Remove the modal and the handleDeleteJob/setJobToDelete logic completely if we want?
// Actually, if we use inline confirmation, the handleDeleteJob logic right now sets state for the modal.
// Let's modify handleDeleteJob to directly delete.
code = code.replace(
  /const handleDeleteJob = \(jobId: string\) => \{\s*setJobToDelete\(jobId\);\s*\};/g,
  `const handleDeleteJob = async (jobId: string) => {
    await JobStore.deleteJob(jobId);
    showToast('Analysis deleted.');
  };`
);

// Remove confirmDeleteJob and the modal UI
code = code.replace(
  /const confirmDeleteJob = async \(\) => \{[\s\S]*?\};\s*/g,
  ''
);

code = code.replace(
  /\{jobToDelete && \([\s\S]*?\}\s*<\/div>,\s*document\.body\s*\)\}/g,
  ''
);


fs.writeFileSync('src/components/AllAnalysesModal.tsx', code);
