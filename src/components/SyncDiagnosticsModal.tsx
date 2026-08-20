import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Download, RefreshCw, Loader } from 'lucide-react';
import { auth } from '../firebase';

interface SyncDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SyncDiagnosticsModal: React.FC<SyncDiagnosticsModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const uid = auth.currentUser?.uid || '';
      const email = auth.currentUser?.email || '';
      const params = new URLSearchParams();
      if (uid) params.set('uid', uid);
      if (email) params.set('email', email);
      const res = await fetch(`/api/debug/supabase-pull-check?${params.toString()}`, {
        headers: auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}
      });
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch diagnostics.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isOpen && !data && !loading) {
      fetchDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const jsonText = data ? JSON.stringify(data, null, 2) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API access (e.g. some in-app webviews)
      const textarea = document.createElement('textarea');
      textarea.value = jsonText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Copy failed. Try Download instead.');
      }
      document.body.removeChild(textarea);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `sync-diagnostics-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-white font-bold text-sm">Sync Diagnostics</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 border-b border-slate-800 flex-wrap">
          <button
            onClick={fetchDiagnostics}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold disabled:opacity-50"
          >
            {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
          <button
            onClick={handleCopy}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
          <button
            onClick={handleDownload}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {loading && !data && (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
              <Loader className="w-4 h-4 animate-spin" /> Loading diagnostics...
            </div>
          )}
          {error && (
            <div className="text-rose-400 text-xs bg-rose-950/30 border border-rose-900/40 rounded-lg p-3 mb-3">
              {error}
            </div>
          )}
          {data && (
            <pre className="text-[10px] leading-relaxed text-emerald-300 whitespace-pre-wrap break-all font-mono">
              {jsonText}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SyncDiagnosticsModal;
