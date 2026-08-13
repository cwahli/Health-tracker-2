import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Upload, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight, Trash2, Download } from 'lucide-react';

type CaseRow = {
  id: string;
  title: string;
  status: string;
  job_id?: string;
  photo_url?: string;
  pass_count: number;
  fail_count: number;
  iteration: number;
  all_green: boolean;
  updated_at: string;
};

function formatLabelText(val: any): string {
  if (!val) return '';
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(\.)([A-Z])/g, '$1 $2')
    .replace(/:\s*/g, ': ');
}

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

  const deleteCase = async (id: string) => {
    if (!window.confirm('Delete this golden meal?')) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/golden/cases/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'delete failed');
      await load();
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
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.all_green ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                  {c.status}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  Fix Iteration #{openId === c.id && detail ? (detail.iteration || c.iteration || 1) : (c.iteration || 1)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-black/40 overflow-hidden flex">
                <div className="bg-emerald-500" style={{ width: `${pct(c.pass_count, c.pass_count + c.fail_count)}%` }} />
                <div className="bg-rose-500" style={{ width: `${pct(c.fail_count, c.pass_count + c.fail_count)}%` }} />
              </div>
              <p className="text-[10px] text-white/60 mt-1 flex items-center gap-2">
                <span className="text-emerald-300 font-semibold">{c.pass_count} Fixed so far</span>
                <span>·</span>
                <span className="text-rose-300 font-semibold">{c.fail_count} Still pending</span>
                <span>·</span>
                <span>job {c.job_id || '—'}</span>
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
            <button type="button" onClick={() => deleteCase(c.id)} className="px-2.5 py-1 rounded-lg bg-rose-700 text-[10px] font-bold text-white flex items-center gap-1">
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
          {openId === c.id && detail && (
            <div className="px-3 pb-3 space-y-3 border-t border-white/10 pt-2 text-xs">
              <div className="flex flex-wrap gap-2 mb-2">
                {detail.logUrl && (
                  <a href={detail.logUrl} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-800/60">
                    <Download className="w-3 h-3" />
                    Download Logs
                  </a>
                )}
                {detail.scoutUrl && (
                  <a href={detail.scoutUrl} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-indigo-900/40 border border-indigo-500/40 text-indigo-300 text-[10px] font-bold flex items-center gap-1 hover:bg-indigo-800/60">
                    <Download className="w-3 h-3" />
                    Download Prompt (Scout)
                  </a>
                )}
              </div>
              {/* Iteration & Fix Actions */}
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-300 text-[11px]">Fix Iteration Progress</span>
                  <span className="text-[10px] text-indigo-200 bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-400/30 font-semibold">
                    Iteration #{detail.iteration || c.iteration || 1}
                  </span>
                </div>
                {(detail.attempts || []).length > 0 ? (
                  <div className="space-y-1 text-[11px] text-white/80">
                    <p className="font-semibold text-indigo-200">What was done to fix it:</p>
                    {detail.attempts.slice(-3).map((a: any) => (
                      <div key={a.n} className="bg-black/30 p-1.5 rounded border border-white/10 space-y-0.5">
                        <p className="text-emerald-300 font-medium">Attempt #{a.n} ({a.actor || 'studio'})</p>
                        <p className="text-white/90"><span className="text-white/60">Action taken:</span> {a.tried}</p>
                        <p className="text-amber-200"><span className="text-white/60">Learned:</span> {a.learned}</p>
                        {a.replaySummary && <p className="text-indigo-200"><span className="text-white/60">Result:</span> {a.replaySummary}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/50 italic">No explicit fix attempts logged yet for this iteration. Re-run after code edits.</p>
                )}
              </div>

              {detail.board?.resolutionStats && (
                <div className="text-[10px] text-sky-200/90 space-y-1 rounded-xl border border-sky-500/20 bg-sky-950/30 p-2">
                  <p className="font-bold text-sky-300">Food Resolution Diagnostics</p>
                  <p>
                    <span className="font-medium text-white">Sampled Components:</span> {detail.board.resolutionStats.sampled}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span title="Found in USDA database"><span className="text-sky-400 font-bold">USDA:</span> {detail.board.resolutionStats.usda}</span>
                    <span title="Found in internal catalog"><span className="text-indigo-400 font-bold">Catalog:</span> {detail.board.resolutionStats.catalog}</span>
                    <span title="Sorted by resolver/curator"><span className="text-emerald-400 font-bold">Verified/Curator:</span> {detail.board.resolutionStats.curator}</span>
                    <span title="Used default/estimated assignment"><span className="text-amber-400 font-bold">Fallback:</span> {detail.board.resolutionStats.fallback}</span>
                  </div>
                </div>
              )}

              {detail.fixture && (
                <div className="text-[10px] text-emerald-200/90 space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-950/30 p-2">
                  <p className="font-bold text-emerald-300">Meal Picture & Query (from food log)</p>
                  <p>Query: {detail.fixture.query ? `“${detail.fixture.query}”` : '(photo only)'}</p>
                  {(() => {
                    const rawPhotos = detail.fixture.photos || detail.fixture.photoList || detail.fixture.imageRefs;
                    const photoList: string[] = Array.isArray(rawPhotos) && rawPhotos.length > 0
                      ? rawPhotos
                      : ([detail.fixture.photo, detail.fixture.photoUrl, detail.fixture.imageUrl, c.photo_url].filter(Boolean) as string[]);
                    return photoList.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {photoList.map((u: string, i: number) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                            <img src={u} alt={`meal photo ${i + 1}`} className="h-14 w-14 object-cover rounded border border-emerald-400/40" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-white/40 italic mt-0.5">No image attached</p>
                    );
                  })()}
                </div>
              )}

              {/* Top Dishes / Meal Lines Expected vs Current Iteration Comparison */}
              {Array.isArray(detail.board?.expectedMeal) && detail.board.expectedMeal.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-white/15 bg-slate-900/80 p-2.5">
                  <p className="font-bold text-white text-[11px] flex items-center justify-between">
                    <span>Meal Dishes / Lines — Expected vs Current Iteration</span>
                  </p>
                  <div className="space-y-1 text-[10px]">
                    {detail.board.expectedMeal.map((exp: any, idx: number) => {
                      const obs = (detail.board?.observedMeal || []).find((o: any) =>
                        o.name?.toLowerCase().includes(exp.name?.toLowerCase()) || exp.name?.toLowerCase().includes(o.name?.toLowerCase())
                      ) || (detail.board?.observedMeal || [])[idx];
                      const isMatch = obs ? (exp.calories == null || Math.abs((obs.calories ?? 0) - (exp.calories ?? 0)) < 30 || exp.scored === false) : false;
                      return (
                        <div key={idx} className={`p-1.5 rounded border flex flex-wrap items-center justify-between gap-1 ${isMatch ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-rose-950/30 border-rose-500/30'}`}>
                          <div>
                            <p className="font-semibold text-white">{exp.name}</p>
                            <p className="text-white/60">Expected: {exp.calories != null ? `${exp.calories} kcal` : 'N/A'} · {exp.weightGrams != null ? `${exp.weightGrams}g` : 'N/A'}</p>
                          </div>
                          <div className="text-right">
                            <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${isMatch ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                              {isMatch ? '✓ PASSED' : '✗ PENDING'}
                            </span>
                            <p className="text-white/70 mt-0.5">
                              Current: {obs ? `${obs.calories ?? 0} kcal (${obs.weightGrams ?? 0}g)` : 'Missing in current run'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Fixed So Far vs Still Pending Requirements */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Fixed So Far */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-2.5 space-y-1.5">
                  <p className="font-bold text-emerald-300 text-[11px] flex items-center gap-1">
                    <span>Fixed So Far (Passed)</span>
                  </p>
                  {((detail.board?.outcomes || []).filter((o: any) => o.pass === true)).length === 0 ? (
                    <p className="text-[10px] text-white/50 italic">None fixed so far in this iteration.</p>
                  ) : (
                    (detail.board?.outcomes || []).filter((o: any) => o.pass === true).map((o: any) => (
                      <div key={o.id} className="text-[10px] p-1.5 rounded bg-emerald-900/30 border border-emerald-500/20 text-emerald-100 space-y-0.5">
                        <p className="font-medium text-emerald-200">✓ {formatLabelText(o.label)}</p>
                        <p className="text-white/60">Expected: {formatLabelText(o.expected ?? 'Pass')} | Current: {formatLabelText(o.actual ?? 'OK (Pass)')}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Still Pending */}
                <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-2.5 space-y-1.5">
                  <p className="font-bold text-rose-300 text-[11px] flex items-center gap-1">
                    <span>Still Pending (To Fix)</span>
                  </p>
                  {((detail.board?.outcomes || []).filter((o: any) => o.pass !== true)).length === 0 ? (
                    <p className="text-[10px] text-emerald-300 italic">All green! Everything fixed.</p>
                  ) : (
                    (detail.board?.outcomes || []).filter((o: any) => o.pass !== true).map((o: any) => (
                      <div key={o.id} className="text-[10px] p-1.5 rounded bg-rose-900/30 border border-rose-500/20 text-rose-100 space-y-0.5">
                        <p className="font-medium text-rose-200">✗ {formatLabelText(o.label)}</p>
                        <p className="text-white/60">Expected: {formatLabelText(o.expected ?? 'No error')} | Current: {formatLabelText(o.actual ?? 'Failing / Triggered')}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {(detail.board?.tensions || []).length > 0 && (
                <div className="text-[10px] text-amber-200/90 space-y-1 rounded-xl border border-amber-500/30 bg-amber-950/30 p-2">
                  <p className="font-bold text-amber-300">Tensions / Warnings</p>
                  {detail.board.tensions.map((t: any) => (
                    <p key={t.id}>
                      {t.left} ↔ {t.right} — {t.note}
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
