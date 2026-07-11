import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Send, Check, AlertTriangle, Search } from 'lucide-react';

interface FullScreenLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  logsText: string;
  logsArray?: string[];
  onSendToAdmin?: () => Promise<void>;
  isSendingLogs?: boolean;
  logsSendStatus?: 'idle' | 'success' | 'error';
  onClearLogs?: () => void;
  eventsCount?: number;
}

export default function FullScreenLogViewer({
  isOpen,
  onClose,
  title,
  logsText,
  logsArray,
  onSendToAdmin,
  isSendingLogs = false,
  logsSendStatus = 'idle',
  onClearLogs,
  eventsCount
}: FullScreenLogViewerProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const chunks = useMemo(() => {
    if (logsArray && logsArray.length > 0) return logsArray;
    return logsText ? [logsText] : [];
  }, [logsText, logsArray]);

  const filteredChunks = useMemo(() => {
    if (!searchTerm) return chunks;
    const lowerSearch = searchTerm.toLowerCase();
    return chunks.filter(chunk => chunk.toLowerCase().includes(lowerSearch));
  }, [chunks, searchTerm]);

  if (!isOpen) return null;

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(logsText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const handleCopyChunk = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy chunk:', err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col animate-fade-in w-full h-[100dvh] text-slate-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono">
              {title}
            </h2>
          </div>
          {chunks.length > 0 && (
            <div className="relative max-w-sm flex-1 ml-4 hidden sm:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
          )}
        </div>
        
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer ml-4"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {chunks.length > 0 && (
        <div className="px-4 py-2 bg-slate-950 border-b border-slate-800/60 sm:hidden">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 mx-[10px] py-4 bg-transparent flex flex-col min-h-0">
        {filteredChunks.length === 0 ? (
          <span className="text-slate-500 italic font-mono text-xs px-2">
            {chunks.length === 0 ? 'No logs recorded yet.' : 'No matches found.'}
          </span>
        ) : (
          <textarea
            readOnly
            value={filteredChunks.join('\n\n')}
            className="flex-1 w-full bg-slate-900/50 border border-slate-800/80 rounded-xl p-4 font-mono text-[11px] text-slate-300 leading-relaxed outline-none resize-none overflow-y-auto select-text focus:outline-none"
          />
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-950">
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
          {eventsCount !== undefined ? (
            <span>{eventsCount} events logged</span>
          ) : (
            <span>{logsText ? `${logsText.length} characters` : 'Empty log'}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onClearLogs && (
            <button
              onClick={onClearLogs}
              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-950/25 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Clear Log
            </button>
          )}
          <button
            onClick={handleCopyAll}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {copiedAll ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Copied All!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy All</span>
              </>
            )}
          </button>
          {onSendToAdmin && (
            <button
              onClick={onSendToAdmin}
              disabled={isSendingLogs || !logsText}
              className={`px-3 py-1.5 border rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                logsSendStatus === 'success'
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : logsSendStatus === 'error'
                  ? 'bg-rose-650 border-rose-550 text-white'
                  : 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-700'
              }`}
            >
              {isSendingLogs ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Sending...</span>
                </>
              ) : logsSendStatus === 'success' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Sent!</span>
                </>
              ) : logsSendStatus === 'error' ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>Failed!</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send to Admin</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  , document.body);
}
