import React from 'react';
import { X, RotateCcw, EyeOff } from 'lucide-react';

interface NotUsedBiomarkersModalProps {
  isOpen: boolean;
  onClose: () => void;
  flaggedKeys: string[];
  getDisplayName: (key: string) => string;
  onRestore: (key: string) => void;
}

export const NotUsedBiomarkersModal: React.FC<NotUsedBiomarkersModalProps> = ({
  isOpen,
  onClose,
  flaggedKeys,
  getDisplayName,
  onRestore,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <EyeOff className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
              Not Used Biomarkers
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
              {flaggedKeys.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content / List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-2">
          {flaggedKeys.length === 0 ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
              No biomarkers hidden
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {flaggedKeys.map((key) => {
                const displayName = getDisplayName(key) || key;
                return (
                  <div
                    key={key}
                    className="px-4 py-3 flex items-center justify-between gap-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {displayName}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">
                        {key}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestore(key)}
                      className="px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Add back
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotUsedBiomarkersModal;
