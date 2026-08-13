import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Upload, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

type CaseRow = {
  id: string;
  title: string;
  status: string;
  job_id?: string;
  pass_count: number;
  fail_count: number;
  iteration: number;
  all_green: boolean;
  updated_at: string;
};

export default function GoldenInboxPanel() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/golden/cases');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCases(j.cases || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load golden cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCase = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    const r = await fetch(`/api/golden/cases/${id}`);
    const j = await r.json();
    setDetail(j);
  };

  const replay = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/golden/cases/${id}/replay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'replay failed');
      await load();
      if (openId === id) await openCase(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const promote = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/golden/cases/${id}/promote`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'promote failed');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const copyStudioPrompt = async (id: string) => {
    const r = await fetch('/api/golden/studio-brief');
    const md = await r.text();
    await navigator.clipboard.writeText(
      `Check the latest golden bug and fix it.\n\nUse GET /api/golden/studio-brief if this is stale.\nDo not change expected numbers. Read attempts before retrying an approach.\nAfter edits POST /api/golden/cases/${id}/attempt with tried/learned/next, then POST .../replay.\n\n---\n${md}`
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-white">Golden inbox</p>
          <p className="text-[11px] text-white/60">A = your result lines. B = known + promoted log issues. Replay is the only pass/fail.</p>
        </div>
        <button type="button" onClick={load} className="p-2 rounded-lg bg-slate-800 border border-white/15 text-white">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-900/60 text-xs text-white flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {cases.length === 0 && !loading && (
        <p className="text-xs text-white/60">No golden cases yet. Snapshot a meal and tick “Save as golden meal”.</p>
      )}

      {cases.map((c) => (
        <div key={c.id} className="rounded-2xl border border-white/15 bg-slate-800/80 overflow-hidden">
          <button
            type="button"
            onClick={() => openCase(c.id)}
            className="w-full text-left p-3 flex items-start gap-2"
          >
            {openId === c.id ? <ChevronDown className="w-4 h-4 mt-0.5 text-white/50" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-white/50" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-white truncate">{c.title}</span>
                <span className={`text-[10px] font-bold ${c.all_green ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {c.status}
                </span>
                <span className="text-[10px] text-white/50">iter {c.iteration}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-black/40 overflow-hidden flex">
                <div className="bg-emerald-500" style={{ width: `${pct(c.pass_count, c.pass_count + c.fail_count)}%` }} />
                <div className="bg-rose-500" style={{ width: `${pct(c.fail_count, c.pass_count + c.fail_count)}%` }} />
              </div>
              <p className="text-[10px] text-white/50 mt-1">
                {c.pass_count} pass · {c.fail_count} fail · job {c.job_id || '—'}
              </p>
            </div>
          </button>
          <div className="px-3 pb-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => replay(c.id)} className="px-2.5 py-1 rounded-lg bg-indigo-600 text-[10px] font-bold text-white flex items-center gap-1">
              {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Re-run
            </button>
            <button
              type="button"
              disabled={!c.all_green}
              onClick={() => promote(c.id)}
              className="px-2.5 py-1 rounded-lg bg-emerald-700 disabled:opacity-30 text-[10px] font-bold text-white flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              Promote
            </button>
            <button type="button" onClick={() => copyStudioPrompt(c.id)} className="px-2.5 py-1 rounded-lg bg-slate-700 text-[10px] font-bold text-white flex items-center gap-1">
              <Upload className="w-3 h-3" />
              Copy AI Studio prompt
            </button>
          </div>
          {openId === c.id && detail && (
            <div className="px-3 pb-3 space-y-2 border-t border-white/10 pt-2">
              {detail.fixture && (
                <div className="text-[10px] text-emerald-200/90 space-y-1">
                  <p className="font-bold text-emerald-300">Original input (frozen)</p>
                  <p>Query: {detail.fixture.query ? `“${detail.fixture.query}”` : '(photo only)'}</p>
                  <div className="flex flex-wrap gap-1">
                    {(detail.fixture.photos || []).map((u: string, i: number) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                        <img src={u} alt={`fixture ${i + 1}`} className="h-12 w-12 object-cover rounded border border-white/20" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {(detail.board?.outcomes || []).map((o: any) => (
                <div key={o.id} className="text-[11px] flex gap-2">
                  <span className={o.pass === true ? 'text-emerald-300' : o.pass === false ? 'text-rose-300' : 'text-white/40'}>
                    {o.pass === true ? '✓' : o.pass === false ? '✗' : '·'}
                  </span>
                  <span className="text-white/90">{o.label}</span>
                </div>
              ))}
              {(detail.board?.tensions || []).length > 0 && (
                <div className="text-[10px] text-amber-200/90 space-y-1">
                  <p className="font-bold text-amber-300">Tensions (not on the board until you promote them)</p>
                  {detail.board.tensions.map((t: any) => (
                    <p key={t.id}>
                      {t.left} ↔ {t.right} — {t.note}
                    </p>
                  ))}
                </div>
              )}
              {(detail.attempts || []).length > 0 && (
                <div className="text-[10px] text-white/70 space-y-1">
                  <p className="font-bold text-white/80">Attempts / learnings</p>
                  {detail.attempts.slice(-6).map((a: any) => (
                    <p key={a.n}>
                      #{a.n} tried: {a.tried} → learned: {a.learned}
                      {a.n >= 5 && a.createdNewIssue ? ' · do not retry this class' : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}
