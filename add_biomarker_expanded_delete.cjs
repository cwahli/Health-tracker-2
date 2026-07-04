const fs = require('fs');
let content = fs.readFileSync('src/components/BiomarkerExpandedSection.tsx', 'utf8');

const t1 = `  onEditBiomarkerLog?: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog?: (id: string) => void;`;
const r1 = `  onEditBiomarkerLog?: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog?: (id: string) => void;
  onDeleteBiomarker?: (key: string) => void;`;
content = content.replace(t1, r1);

const t2 = `  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onOpenAiReview,`;
const r2 = `  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onDeleteBiomarker,
  onOpenAiReview,`;
content = content.replace(t2, r2);

const t3 = `      <div className="flex gap-2 mb-4">
        <button
          onClick={(e) => {`;
const r3 = `      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={(e) => {`;
content = content.replace(t3, r3);

const t4 = `            Combine
          </button>
        )}
      </div>`;
const r4 = `            Combine
          </button>
        )}
        {onDeleteBiomarker && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(\`Are you sure you want to completely delete "\${def.name}" and all its historical records?\`)) {
                onDeleteBiomarker(def.key);
              }
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 font-bold text-xs rounded-xl border border-rose-100 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        )}
      </div>`;
content = content.replace(t4, r4);

fs.writeFileSync('src/components/BiomarkerExpandedSection.tsx', content);
