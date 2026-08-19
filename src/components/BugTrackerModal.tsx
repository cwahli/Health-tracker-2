import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Bug,
  X,
  RefreshCw,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  AlertCircle,
  Plus,
  Edit2,
  Save,
  FileText,
  Sparkles,
  Download,
  Loader2,
  Eye,
  ArrowRight,
  Terminal,
  ExternalLink,
  Flame,
  CheckCircle2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { FlagIssueForm, CATEGORY_OPTIONS, saveBugTrackerCache } from './FlagIssueModal';
import { BugCategory } from '../utils/issueBacklog';
import { AVAILABLE_LLMS } from '../utils/llm';
import { saveAgentRequestLog } from '../utils/agentLogsTracker';
import GoldenInboxPanel from './GoldenInboxPanel';
import { bugArtifactUrl, evidencePhotoSrc } from '../utils/bugSnapshot';
import {
  hydrateWorkItem,
  publicId,
  sortReadyQueue,
  BURN_BUDGET,
  BugWorkItem,
  BugCommit,
  BugAttempt,
  BugEvidence,
  BugNow,
} from '../utils/bugWorkItem';

interface BugTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BugTrackerModal({ isOpen, onClose }: BugTrackerModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    bugTags: any[];
    allReports: any[];
    deletionCandidates: any[];
  } | null>(null);

  const [activeTab, setActiveTab] = useState<BugCategory | 'all'>('all');
  const [boardMode, setBoardMode] = useState<'bugs' | 'golden'>('bugs');
  const [isFlagFormOpen, setIsFlagFormOpen] = useState(false);

  // Selected tag in right pane
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedTagDetail, setSelectedTagDetail] = useState<{
    bug?: any;
    now?: BugNow;
    commits?: BugCommit[];
    reports?: any[];
    how_to_end?: string;
    say?: string;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Editable Bug field & Remaining in right pane
  const [editingBugField, setEditingBugField] = useState(false);
  const [editBugDraft, setEditBugDraft] = useState('');
  const [editingRemaining, setEditingRemaining] = useState(false);
  const [editRemainingDraft, setEditRemainingDraft] = useState('');
  const [savingField, setSavingField] = useState(false);

  // Adding attempt / note form
  const [showAddAttempt, setShowAddAttempt] = useState(false);
  const [attemptHyp, setAttemptHyp] = useState('');
  const [attemptFile, setAttemptFile] = useState('');
  const [attemptTest, setAttemptTest] = useState('');
  const [attemptResult, setAttemptResult] = useState('still_red');
  const [attemptBurned, setAttemptBurned] = useState(true);
  const [attemptNote, setAttemptNote] = useState('');
  const [submittingAttempt, setSubmittingAttempt] = useState(false);

  // UI expand states
  const [openSnapCommitIds, setOpenSnapCommitIds] = useState<Record<string, boolean>>({});
  const [openPreBlocks, setOpenPreBlocks] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption?: string } | null>(null);

  // Action states
  const [copiedTagId, setCopiedTagId] = useState<string | null>(null);
  const [copiedHandoffId, setCopiedHandoffId] = useState<string | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [zippingTagId, setZippingTagId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // AI Triage states
  const [triageModelByTag, setTriageModelByTag] = useState<Record<string, string>>({});
  const [triagingTagId, setTriagingTagId] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<string | null>(null);
  const [analyzeModalTag, setAnalyzeModalTag] = useState<{ id: string; title: string; modelId: string } | null>(null);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);

  // Artifact viewer
  const [viewingArtifact, setViewingArtifact] = useState<{ name: string; content: string } | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);

  useEffect(() => {
    if (!analyzeModalTag) {
      setAnalyzeElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setAnalyzeElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [analyzeModalTag]);

  const artifactUrl = (tagId: string, reportId: string, name: string, key?: string) =>
    bugArtifactUrl(tagId, reportId, name, key);

  const viewTextArtifact = async (tagId: string, reportId: string, name: string) => {
    setArtifactLoading(true);
    try {
      const res = await fetch(artifactUrl(tagId, reportId, name));
      const ct = res.headers.get('content-type') || '';
      let content = '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        content = 'data' in json ? JSON.stringify(json.data, null, 2) : String(json.text ?? JSON.stringify(json, null, 2));
      } else {
        content = await res.text();
      }
      setViewingArtifact({ name, content });
    } catch (e: any) {
      alert(e?.message || 'Failed to load artifact');
    } finally {
      setArtifactLoading(false);
    }
  };

  const downloadTagZip = async (tag: any) => {
    setZippingTagId(tag.id);
    try {
      const JSZip = (await import('jszip')).default;
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();

      const item = hydrateWorkItem(tag);
      const bugSummaryContent = [
        `# Bug Summary: ${tag.title || tag.id}`,
        `- Public ID: ${publicId(item, tag.id)}`,
        `- Category: ${tag.category || 'Other'}`,
        `- Queue: ${item.queue}`,
        `- ID: ${tag.id}`,
        `- Exported At: ${new Date().toISOString()}`,
        '',
        `## Pinned Bug Instruction`,
        item.bug || tag.identified_problems || '(No bug instruction recorded)',
        '',
        `## Progress & Notes`,
        tag.comments?.map((c: any) => `- [${c.created_at || ''}] ${c.body || ''}`).join('\n') ||
          tag.resolution_note ||
          '(No progress notes recorded)',
        '',
        `## What's Still Open`,
        item.remaining.join('\n') || tag.whats_still_open || '(None)',
      ].join('\n');

      zip.file('bug_summary.md', bugSummaryContent);
      zip.file('bug summary.md', bugSummaryContent);

      zip.file(
        'meta.json',
        JSON.stringify(
          {
            id: tag.id,
            public_id: publicId(item, tag.id),
            title: tag.title,
            category: tag.category,
            status: tag.status,
            work_item: item,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      const reports = (tag.linked_issues || selectedTagDetail?.reports || []).filter((li: any) => li.reportId || li.id);

      for (const li of reports) {
        const reportId = li.reportId || li.id;
        const folder = zip.folder(String(reportId).slice(0, 8));
        if (!folder) continue;

        for (const shot of li.r2_shots || []) {
          const name = String(shot.key).split('/').pop() as string;
          try {
            const res = await fetch(artifactUrl(tag.id, reportId, name));
            if (res.ok) folder.file(name, await res.blob());
          } catch {}
        }

        const standardNames = [
          'accessibility_tree.txt',
          'domain_pack.json',
          'overview.md',
          'console.logs.txt',
          'network.recent.json',
          'dom.simplified.json',
          'note.txt',
          'payload.json',
          'debug_payload.json',
        ];

        for (const name of standardNames) {
          try {
            const res = await fetch(artifactUrl(tag.id, reportId, name));
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            let text = '';
            if (ct.includes('application/json')) {
              const json = await res.json();
              text = JSON.stringify('data' in json ? json.data : json, null, 2);
            } else {
              text = await res.text();
            }
            folder.file(name, text);
          } catch {}
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `bug-${publicId(item, tag.id).replace('#', '')}-${tag.id.slice(0, 8)}.zip`);
    } catch (e: any) {
      alert(e?.message || 'Zip download failed');
    } finally {
      setZippingTagId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bug-tracker/overview');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      saveBugTrackerCache(json);
      const nowStr = new Date().toLocaleTimeString();
      setLastUpdated(nowStr);

      // Auto-select head of ready queue if none selected
      if (json.bugTags && json.bugTags.length > 0) {
        const sorted = sortReadyQueue(json.bugTags);
        const top = sorted[0] || json.bugTags[0];
        if (!selectedTagId || !json.bugTags.some((t: any) => t.id === selectedTagId)) {
          setSelectedTagId(top.id);
          fetchTagDetail(top.id);
        } else {
          fetchTagDetail(selectedTagId);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load bug tracker data');
    } finally {
      setLoading(false);
    }
  };

  const fetchTagDetail = async (tagId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bugs/${tagId}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSelectedTagDetail(json);
        setEditBugDraft(json.now?.bug || json.bug?.identified_problems || json.bug?.title || '');
        setEditRemainingDraft((json.now?.remaining || []).join(', '));
      }
    } catch {
      /* ignore fetch error */
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem('bug_tracker_local_cache');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.bugTags)) {
            setData(parsed);
            if (parsed._cachedAt) setLastUpdated(parsed._cachedAt);
          }
        }
      } catch (e) {
        console.warn('Failed to load local bug cache:', e);
      }
      load();
    }
  }, [isOpen]);

  const handleSelectTag = (tagId: string) => {
    setSelectedTagId(tagId);
    setEditingBugField(false);
    setEditingRemaining(false);
    setShowAddAttempt(false);
    fetchTagDetail(tagId);
  };

  const handleNextBug = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bugs/next');
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.empty && json.tag_id) {
        setSelectedTagId(json.tag_id);
        setSelectedTagDetail(json);
        setEditBugDraft(json.now?.bug || '');
        setEditRemainingDraft((json.now?.remaining || []).join(', '));
      } else {
        // Fallback to top ready tag in local data
        if (data?.bugTags) {
          const ready = sortReadyQueue(data.bugTags);
          if (ready.length > 0) {
            handleSelectTag(ready[0].id);
          } else {
            alert('No ready bugs in the queue!');
          }
        }
      }
    } catch {
      /* fallback */
    } finally {
      setLoading(false);
    }
  };

  const saveBugField = async () => {
    if (!selectedTagId) return;
    setSavingField(true);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bug: editBugDraft.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update bug field');
      if (selectedTagDetail) {
        setSelectedTagDetail({
          ...selectedTagDetail,
          now: selectedTagDetail.now ? { ...selectedTagDetail.now, bug: editBugDraft.trim() } : undefined,
        });
      }
      setEditingBugField(false);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to save bug instruction');
    } finally {
      setSavingField(false);
    }
  };

  const saveRemainingItems = async () => {
    if (!selectedTagId) return;
    setSavingField(true);
    const rem = editRemainingDraft.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remaining: rem }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update remaining items');
      if (selectedTagDetail?.now) {
        setSelectedTagDetail({
          ...selectedTagDetail,
          now: { ...selectedTagDetail.now, remaining: rem },
        });
      }
      setEditingRemaining(false);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to save remaining items');
    } finally {
      setSavingField(false);
    }
  };

  const handleLogAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId) return;
    setSubmittingAttempt(true);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: 'developer',
          hyp: attemptHyp.trim(),
          file: attemptFile.trim(),
          test: attemptTest.trim(),
          result: attemptResult,
          burned: attemptBurned,
          note: attemptNote.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to record attempt');
      setShowAddAttempt(false);
      setAttemptHyp('');
      setAttemptFile('');
      setAttemptTest('');
      setAttemptNote('');
      await fetchTagDetail(selectedTagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to log attempt');
    } finally {
      setSubmittingAttempt(false);
    }
  };

  const runBugTriageAgent = async (tag: any) => {
    const selectedModel = triageModelByTag[tag.id] || 'gemini-3.5-flash-lite';
    setBusy(true);
    setTriagingTagId(tag.id);
    setAnalyzeModalTag({
      id: tag.id,
      title: tag.title || tag.id,
      modelId: selectedModel,
    });
    setTriageStatus('Starting AI Bug Triage Agent...');
    try {
      const res = await fetch(`/api/bugs/${tag.id}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTriageStatus(`Triage completed in ${json.ms || '?'}ms`);
      await fetchTagDetail(tag.id);
      await load();
      setTimeout(() => setTriageStatus(null), 4000);
    } catch (err: any) {
      setTriageStatus(null);
      alert(err?.message || 'Triage failed');
    } finally {
      setAnalyzeModalTag(null);
      setTriagingTagId(null);
      setBusy(false);
    }
  };

  const deleteTag = async (tagId: string, title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Mark "${title}" done? The card stays in history (not hard-deleted).`)) return;
    setDeletingTagId(tagId);
    try {
      const res = await fetch(`/api/issue-tags/${encodeURIComponent(tagId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'fixed', resolution_note: 'Marked done from queue' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Failed (HTTP ${res.status})`);
      }
      if (selectedTagId === tagId) {
        setSelectedTagId(null);
        setSelectedTagDetail(null);
      }
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to mark bug done');
    } finally {
      setDeletingTagId(null);
    }
  };

  const pruneReport = async (tagId: string, issueId: string) => {
    if (!confirm('Remove R2 artifacts for this report (mark obsolete)?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bugs/${tagId}/reports/${issueId}/prune`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchTagDetail(tagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Prune failed');
    } finally {
      setBusy(false);
    }
  };

  const copyTagSummary = (tag: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const item = hydrateWorkItem(tag);
    const pub = publicId(item, tag.id);
    const lines = [
      `Bug ${pub}: ${tag.title}`,
      `Category: ${tag.category || 'Other'} | Queue: ${item.queue}`,
      `Instruction: ${item.bug || tag.identified_problems || '(None)'}`,
      `Remaining: ${item.remaining.join(', ') || tag.whats_still_open || '(None)'}`,
      `Burns: ${item.burns.filter((b) => b.burned).length}/${BURN_BUDGET}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedTagId(tag.id);
    setTimeout(() => setCopiedTagId(null), 2000);
  };

  const copyHandoff = async (tag: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const res = await fetch(`/api/bugs/${tag.id}`);
    const json = await res.json().catch(() => ({}));
    const pub = json.now?.public_id || publicId(hydrateWorkItem(tag), tag.id);
    const last = (json.commits || []).slice(-1)[0];
    const text = [
      `Check this bug and fix it. ${pub} — ${tag.title}`,
      '',
      json.now?.bug || hydrateWorkItem(tag).bug || tag.title,
      '',
      `Remaining: ${(json.now?.remaining || []).join(' · ') || '—'}`,
      `Tried / do not retry: ${(json.now?.tried || []).join('\n') || 'none yet'}`,
      last
        ? `Last loop: ${last.actor} · ${last.summary}${last.attempt ? ` · ${last.attempt.result} · ${last.attempt.file}` : ''}`
        : 'Last loop: none',
      '',
      json.how_to_end || `POST /api/bugs/${tag.id}/attempts { hyp, file, test, result, burned, note }`,
      'Do NOT POST /loop. Do not mark done from chat.',
      '',
      JSON.stringify(
        {
          say: 'Next bug',
          tag_id: tag.id,
          now: json.now,
          commits: json.commits || [],
          how_to_end: json.how_to_end,
        },
        null,
        2
      ),
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedHandoffId(tag.id);
    setTimeout(() => setCopiedHandoffId(null), 2500);
  };

  if (!isOpen) return null;

  const bugTags: any[] = data?.bugTags || [];
  const filteredTags = bugTags.filter(
    (t: any) => activeTab === 'all' || (t.category || 'foodcart') === activeTab
  );
  const sortedQueueTags = sortReadyQueue(filteredTags);

  // Compute KPIs
  const readyCount = bugTags.filter((t) => hydrateWorkItem(t).queue === 'ready').length;
  const blockedCount = bugTags.filter((t) => hydrateWorkItem(t).queue === 'blocked' || hydrateWorkItem(t).burns.filter((b) => b.burned).length >= 2).length;
  const doneCount = bugTags.filter((t) => hydrateWorkItem(t).queue === 'done' || t.status === 'fixed').length;
  const totalMealsCount = bugTags.reduce((acc, t) => acc + (t.linked_count || t.linked_issues?.length || 1), 0);

  // Selected tag object and work item
  const selectedTag = bugTags.find((t: any) => t.id === selectedTagId) || (sortedQueueTags[0] ?? null);
  const selectedTagItem: BugWorkItem = selectedTag ? hydrateWorkItem(selectedTag) : null as any;
  const selectedPubId = selectedTag ? publicId(selectedTagItem, selectedTag.id) : '';
  const selectedBugNow = selectedTagDetail?.now;
  const selectedCommits = selectedTagDetail?.commits || selectedTagItem?.commits || [];
  const selectedReports = selectedTagDetail?.reports || selectedTag?.linked_issues || [];

  // Top ready tag for "Next bug" label
  const topReadyTag = sortReadyQueue(bugTags)[0];
  const topReadyPubId = topReadyTag ? publicId(hydrateWorkItem(topReadyTag), topReadyTag.id) : null;

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[10050] bg-[#0b1220] flex flex-col w-full h-full p-0 text-[#f8fafc] font-sans antialiased overflow-hidden select-text">
          {/* Top Header */}
          <header className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 bg-[#111827]/80 backdrop-blur shrink-0">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 to-indigo-500/20 border border-amber-500/30 text-amber-300 shrink-0">
                <Bug className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                  <span>Bug queue</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-normal">
                    Q-6 Work-Item Engine
                  </span>
                </h1>
                <p className="text-xs text-[#f8fafc]/60 truncate">
                  Original instruction is pinned forever. Each loop is a commit you can open. <strong>Next bug</strong> takes the top ready row.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Next bug Button */}
              <button
                type="button"
                onClick={handleNextBug}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 via-indigo-600 to-indigo-700 hover:from-amber-500 hover:to-indigo-600 text-white font-extrabold text-xs shadow-lg shadow-indigo-900/30 flex items-center gap-2 transition-all cursor-pointer border border-white/20 active:scale-95"
              >
                <span>Next bug</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{topReadyPubId || 'Top Ready'}</span>
              </button>

              {/* Refresh button */}
              <button
                type="button"
                disabled={loading || busy}
                onClick={load}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition-colors"
                title="Refresh bug queue"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>

              {/* Flag issue button */}
              <button
                type="button"
                onClick={() => setIsFlagFormOpen(!isFlagFormOpen)}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-400/40 shadow-sm transition-all shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Flag issue</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isFlagFormOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white/80 border border-white/10 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Main Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col p-4 sm:p-5 space-y-3.5 min-h-0 bg-gradient-to-b from-[#1e3a5f]/20 via-[#0b1220] to-[#0b1220]">
            {error && (
              <div className="p-3 rounded-xl bg-rose-600/90 text-white text-xs font-semibold flex items-center gap-2 shrink-0 shadow-md">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* KPIs grid */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
              <div className="bg-[#111827] border border-white/10 rounded-2xl p-3 shadow-xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/60 block">Ready now</span>
                <b className="text-xl font-extrabold text-emerald-400 mt-0.5 block">{readyCount}</b>
              </div>
              <div className="bg-[#111827] border border-white/10 rounded-2xl p-3 shadow-xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/60 block">Stuck / 2 Burns</span>
                <b className="text-xl font-extrabold text-rose-400 mt-0.5 block">{blockedCount}</b>
              </div>
              <div className="bg-[#111827] border border-white/10 rounded-2xl p-3 shadow-xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/60 block">Meals on open cards</span>
                <b className="text-xl font-extrabold text-amber-300 mt-0.5 block">{totalMealsCount}</b>
              </div>
              <div className="bg-[#111827] border border-white/10 rounded-2xl p-3 shadow-xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/60 block">Done this week</span>
                <b className="text-xl font-extrabold text-slate-300 mt-0.5 block">{doneCount}</b>
              </div>
            </section>

            {/* Board mode & Category filter tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBoardMode('bugs')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    boardMode === 'bugs'
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Bugs Queue
                </button>
                <button
                  type="button"
                  onClick={() => setBoardMode('golden')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    boardMode === 'golden'
                      ? 'bg-amber-600 border-amber-400 text-white shadow-md'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Golden Inbox
                </button>
              </div>

              {boardMode === 'bugs' && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                  {[{ key: 'all', label: 'All' }, ...CATEGORY_OPTIONS].map((c) => {
                    const count =
                      c.key === 'all'
                        ? bugTags.length
                        : bugTags.filter((t: any) => (t.category || 'foodcart') === c.key).length;
                    const isActive = activeTab === c.key;
                    return (
                      <button
                        key={c.key}
                        onClick={() => setActiveTab(c.key as any)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                          isActive
                            ? 'bg-indigo-600/80 border-indigo-400 text-white shadow-sm'
                            : 'bg-slate-800/80 border-white/10 text-white/60 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        <span>{c.label}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                            isActive ? 'bg-indigo-950 text-indigo-200' : 'bg-black/40 text-white/50'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Flag issue dropdown panel */}
            {boardMode === 'bugs' && isFlagFormOpen && (
              <div className="p-4 rounded-2xl bg-[#111827] border border-rose-500/40 shrink-0 shadow-xl max-h-[40vh] overflow-y-auto">
                <FlagIssueForm
                  initialCategory={activeTab === 'all' ? 'foodcart' : activeTab}
                  existingBugTags={bugTags}
                  onSuccess={() => {
                    setIsFlagFormOpen(false);
                    load();
                  }}
                  onCancel={() => setIsFlagFormOpen(false)}
                />
              </div>
            )}

            {/* Golden Inbox Mode */}
            {boardMode === 'golden' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <GoldenInboxPanel />
              </div>
            )}

            {/* 2-Column Dashboard Layout for Bugs Queue */}
            {boardMode === 'bugs' && (
              <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-3.5 flex-1 min-h-0 overflow-hidden">
                {/* LEFT COLUMN: Queue */}
                <section className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden flex flex-col min-h-0 shadow-lg">
                  <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between shrink-0">
                    <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-white/60">
                      Queue — sorted for "Next bug"
                    </h2>
                    <span className="text-[10px] text-white/50 font-mono">
                      {sortedQueueTags.length} card{sortedQueueTags.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="overflow-y-auto flex-1 divide-y divide-white/5 min-h-0">
                    {sortedQueueTags.length === 0 ? (
                      <div className="p-8 text-center text-white/50 text-xs">
                        No active bug cards in {activeTab}.
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="text-[10px] uppercase tracking-wider text-white/50 bg-slate-900/90 sticky top-0 border-b border-white/10 z-10">
                          <tr>
                            <th className="py-2 px-3">#</th>
                            <th className="py-2 px-3">What</th>
                            <th className="py-2 px-2">From</th>
                            <th className="py-2 px-3 text-right">State</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {sortedQueueTags.map((tag) => {
                            const item = hydrateWorkItem(tag);
                            const pub = publicId(item, tag.id);
                            const isSelected = selectedTagId === tag.id;
                            const burnedCount = item.burns.filter((b) => b.burned).length;
                            return (
                              <tr
                                key={tag.id}
                                onClick={() => handleSelectTag(tag.id)}
                                className={`cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-indigo-600/25 border-l-4 border-indigo-400 text-white'
                                    : 'hover:bg-white/5 text-white/90'
                                }`}
                              >
                                <td className="py-3 px-3 font-extrabold text-indigo-300 font-mono shrink-0 whitespace-nowrap">
                                  {pub}
                                </td>
                                <td className="py-3 px-3 min-w-0">
                                  <div className="font-bold text-xs truncate max-w-[210px] text-white">
                                    {tag.title}
                                  </div>
                                  <div className="text-[10px] text-white/50 mt-0.5 truncate max-w-[210px]">
                                    {item.commits.length > 0 ? 'pinned' : 'snap'} ·{' '}
                                    {tag.linked_count || tag.linked_issues?.length || 1} meal
                                    {(tag.linked_count || tag.linked_issues?.length || 1) === 1 ? '' : 's'}{' '}
                                    {burnedCount > 0 ? `· burn ${burnedCount}/${BURN_BUDGET}` : ''}
                                  </div>
                                  {(tag.last_commit || item.commits[item.commits.length - 1]) && (
                                    <div className="text-[10px] text-indigo-200/80 mt-0.5 truncate max-w-[210px]">
                                      last:{' '}
                                      {(tag.last_commit || item.commits[item.commits.length - 1]).actor} ·{' '}
                                      {String(
                                        (tag.last_commit || item.commits[item.commits.length - 1]).summary || ''
                                      ).slice(0, 72)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-2 text-[10px] text-white/60 whitespace-nowrap">
                                  {tag.category || 'auto'}
                                </td>
                                <td className="py-3 px-3 text-right whitespace-nowrap">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border inline-block ${
                                      item.queue === 'ready'
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : item.queue === 'blocked'
                                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                        : item.queue === 'done'
                                        ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                                        : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                                    }`}
                                  >
                                    {item.queue}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>

                {/* RIGHT COLUMN: Open Bug Details (NOW + Commits) */}
                <section className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden flex flex-col min-h-0 shadow-lg">
                  {!selectedTag ? (
                    <div className="p-12 text-center text-white/50 text-xs flex flex-col items-center justify-center h-full">
                      <Bug className="w-8 h-8 text-white/20 mb-2" />
                      <p>Select a bug card from the queue or click <strong>Next bug</strong>.</p>
                    </div>
                  ) : (
                    <>
                      {/* Header bar for selected bug */}
                      <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between gap-3 shrink-0">
                        <div className="min-w-0">
                          <h2 className="text-xs font-bold text-white flex items-center gap-2 truncate">
                            <span className="text-indigo-400 font-mono">{selectedPubId}</span>
                            <span className="truncate">{selectedTag.title}</span>
                          </h2>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Run AI Triage */}
                          <button
                            type="button"
                            disabled={busy || triagingTagId === selectedTag.id}
                            onClick={() => runBugTriageAgent(selectedTag)}
                            className="px-2.5 py-1 text-[11px] font-bold text-violet-200 bg-violet-950/60 hover:bg-violet-900/80 border border-violet-500/40 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                            title="Run AI Triage Agent to synthesize problems"
                          >
                            {triagingTagId === selectedTag.id ? (
                              <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                            ) : (
                              <Sparkles className="w-3 h-3 text-violet-400" />
                            )}
                            <span>Triage</span>
                          </button>

                          {/* Download Zip */}
                          <button
                            type="button"
                            disabled={zippingTagId === selectedTag.id}
                            onClick={() => downloadTagZip(selectedTag)}
                            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition-colors"
                            title="Download Bug Zip with all evidence"
                          >
                            {zippingTagId === selectedTag.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Copy handoff for the next agent */}
                          <button
                            type="button"
                            onClick={(e) => copyHandoff(selectedTag, e)}
                            className="px-2.5 py-1 text-[11px] font-bold text-amber-100 bg-amber-950/70 hover:bg-amber-900/80 border border-amber-500/40 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                            title="Copy Start JSON so another agent can take over"
                          >
                            {copiedHandoffId === selectedTag.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedHandoffId === selectedTag.id ? 'Copied' : 'Hand off'}</span>
                          </button>

                          {/* Copy summary */}
                          <button
                            type="button"
                            onClick={(e) => copyTagSummary(selectedTag, e)}
                            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition-colors"
                            title="Copy Summary"
                          >
                            {copiedTagId === selectedTag.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Mark fixed / delete */}
                          <button
                            type="button"
                            disabled={deletingTagId === selectedTag.id}
                            onClick={(e) => deleteTag(selectedTag.id, selectedTag.title, e)}
                            className="p-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300 transition-colors cursor-pointer"
                            title="Mark Fixed"
                          >
                            {deletingTagId === selectedTag.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" strokeWidth={3} />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Detail Scrollable Body */}
                      <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 min-h-0">
                        {triageStatus && (
                          <div className="p-2.5 rounded-xl bg-violet-950/80 border border-violet-500/40 text-violet-200 text-xs font-semibold flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                            <span>{triageStatus}</span>
                          </div>
                        )}

                        {/* NOW Section */}
                        <div className="bg-[#0f172a] border border-[#334155] rounded-2xl p-4 space-y-3.5 shadow-md">
                          <h3 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                            NOW — what the next agent sees first
                          </h3>
                          {(selectedCommits[selectedCommits.length - 1] || selectedTag.last_commit) && (
                            <div className="text-[11px] rounded-xl border border-indigo-500/30 bg-indigo-950/40 p-2.5 text-indigo-100">
                              <div className="font-extrabold uppercase tracking-wider text-[10px] text-indigo-300 mb-1">
                                Last loop
                              </div>
                              {(() => {
                                const last = selectedCommits[selectedCommits.length - 1] || selectedTag.last_commit;
                                return (
                                  <div>
                                    <span className="font-bold">{last.actor}</span>
                                    {' · '}
                                    {last.summary}
                                    {last.attempt ? (
                                      <div className="font-mono text-[10px] mt-1 text-indigo-200/90">
                                        {last.attempt.result} · {last.attempt.file} · {last.attempt.test}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Pinned Bug Field */}
                          <div className="bg-[#1c1917] border border-[#a16207] rounded-2xl p-3.5 space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                              <span className="flex items-center gap-1.5">
                                <Bug className="w-3.5 h-3.5" />
                                Bug — open field · snap pre-fills · you edit each loop · not deleted
                              </span>
                              {!editingBugField && (
                                <button
                                  type="button"
                                  onClick={() => setEditingBugField(true)}
                                  className="text-amber-300 hover:text-amber-200 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
                                  title="Edit Bug Instruction"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {editingBugField ? (
                              <div className="space-y-2">
                                <textarea
                                  rows={4}
                                  value={editBugDraft}
                                  onChange={(e) => setEditBugDraft(e.target.value)}
                                  className="w-full text-xs rounded-xl p-2.5 bg-black/60 border border-amber-500/40 text-white font-sans focus:outline-none"
                                  placeholder="Describe the bug instruction..."
                                />
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingBugField(false);
                                      setEditBugDraft(selectedBugNow?.bug || selectedTag.identified_problems || '');
                                    }}
                                    className="px-2.5 py-1 text-xs rounded-lg bg-slate-700 text-white cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingField}
                                    onClick={saveBugField}
                                    className="px-3 py-1 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 font-bold text-white flex items-center gap-1 cursor-pointer"
                                  >
                                    {savingField ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                    Save Bug
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs font-semibold text-white/95 leading-relaxed whitespace-pre-wrap">
                                {selectedBugNow?.bug ||
                                  selectedTag.identified_problems ||
                                  selectedTag.title ||
                                  '(No bug instruction recorded)'}
                              </p>
                            )}

                            <div className="text-[10px] text-white/50 border-t border-amber-500/20 pt-1.5">
                              Started as your snap: "{selectedTag.title}" · you (or the summary) update this; full original + agent replies live in commits below
                            </div>
                          </div>

                          {/* NOW Bullets */}
                          <ul className="text-xs space-y-2 text-white/80 list-disc pl-4">
                            <li>
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <strong className="text-white">Remaining:</strong>{' '}
                                  {selectedBugNow?.remaining?.length
                                    ? selectedBugNow.remaining.join(' · ')
                                    : selectedTag.whats_still_open || '—'}
                                </div>
                                {!editingRemaining && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingRemaining(true)}
                                    className="text-amber-400 hover:text-amber-300 text-[10px] font-bold shrink-0"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>

                              {editingRemaining && (
                                <div className="space-y-1.5 mt-1.5 p-2 bg-black/40 rounded-xl border border-white/10">
                                  <input
                                    type="text"
                                    value={editRemainingDraft}
                                    onChange={(e) => setEditRemainingDraft(e.target.value)}
                                    placeholder="Comma-separated remaining items (e.g. no label table, photo crop missing)"
                                    className="w-full text-xs rounded-lg px-2 py-1 bg-black/60 border border-white/20 text-white"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => setEditingRemaining(false)}
                                      className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-white"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={saveRemainingItems}
                                      className="px-2.5 py-0.5 text-[10px] rounded bg-amber-600 font-bold text-white"
                                    >
                                      Save Remaining
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>

                            <li className="text-emerald-300">
                              <strong className="text-white">Done:</strong>{' '}
                              {selectedBugNow?.done?.length
                                ? selectedBugNow.done.join(' · ')
                                : selectedTag.status === 'fixed'
                                ? selectedTag.resolution_note || 'Resolved'
                                : '—'}
                            </li>

                            <li>
                              <strong className="text-white">Current meal:</strong>{' '}
                              {selectedBugNow?.current_evidence?.job_id ||
                                (selectedReports[0]?.dish_query
                                  ? `${selectedReports[0].dish_query} (${selectedReports[0].id.slice(0, 8)})`
                                  : 'None')}
                            </li>

                            {selectedBugNow?.tried && selectedBugNow.tried.length > 0 && (
                              <li className="text-rose-400">
                                <strong className="text-white">
                                  Tried (burns {selectedBugNow.burns_used || `${selectedTagItem.burns.length}/${BURN_BUDGET}`}):
                                </strong>
                                <div className="space-y-1 mt-1 font-mono text-[11px]">
                                  {selectedBugNow.tried.map((t, idx) => (
                                    <div
                                      key={idx}
                                      className="bg-rose-950/40 border border-rose-500/30 p-1.5 rounded-lg text-rose-200"
                                    >
                                      {t}
                                    </div>
                                  ))}
                                </div>
                              </li>
                            )}
                          </ul>
                        </div>

                        {/* Commits / History Timeline */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                              History — one commit per loop (click to view that snap)
                            </h3>
                            <button
                              type="button"
                              onClick={() => setShowAddAttempt(!showAddAttempt)}
                              className="text-[11px] font-bold text-indigo-300 hover:text-indigo-200 flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Log attempt / note</span>
                            </button>
                          </div>

                          {/* Add Attempt Form */}
                          {showAddAttempt && (
                            <form
                              onSubmit={handleLogAttempt}
                              className="p-3.5 bg-slate-900 border border-indigo-500/40 rounded-2xl space-y-2.5 text-xs text-white shadow-md"
                            >
                              <div className="font-bold text-indigo-200 text-xs">Record Attempt or Loop Commit</div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-white/60">Hypothesis *</label>
                                  <input
                                    required
                                    value={attemptHyp}
                                    onChange={(e) => setAttemptHyp(e.target.value)}
                                    placeholder="e.g. tesco includes()"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-white/60">File *</label>
                                  <input
                                    required
                                    value={attemptFile}
                                    onChange={(e) => setAttemptFile(e.target.value)}
                                    placeholder="e.g. FoodCard.tsx"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-white/60">Test *</label>
                                  <input
                                    required
                                    value={attemptTest}
                                    onChange={(e) => setAttemptTest(e.target.value)}
                                    placeholder="e.g. NutritionLabelTable brand"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-white/60">Result</label>
                                  <select
                                    value={attemptResult}
                                    onChange={(e) => {
                                      setAttemptResult(e.target.value);
                                      setAttemptBurned(!/pass|green/i.test(e.target.value));
                                    }}
                                    className="w-full text-xs rounded-lg p-1.5 bg-slate-800 border border-white/20 text-white"
                                  >
                                    <option value="still_red">still_red (Burn)</option>
                                    <option value="pass">pass (Green)</option>
                                    <option value="failed">failed (Burn)</option>
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] text-white/60">Note (optional)</label>
                                <input
                                  value={attemptNote}
                                  onChange={(e) => setAttemptNote(e.target.value)}
                                  placeholder="Observations..."
                                  className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                />
                              </div>
                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setShowAddAttempt(false)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-white/80"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={submittingAttempt}
                                  className="px-3.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-white flex items-center gap-1"
                                >
                                  {submittingAttempt ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                  Record Attempt
                                </button>
                              </div>
                            </form>
                          )}

                          {/* Commits List */}
                          <ul className="space-y-4 list-none p-0 m-0">
                            {selectedCommits.length === 0 ? (
                              <li className="text-white/50 text-xs italic pl-4">No commits logged yet.</li>
                            ) : (
                              [...selectedCommits].reverse().map((commit, idx) => {
                                const isCur = idx === 0;
                                const isFail = commit.attempt?.burned;
                                const snapOpen = Boolean(openSnapCommitIds[commit.id || `c${idx}`]);
                                const evidence = commit.evidence || selectedBugNow?.current_evidence;
                                const photos = evidence?.photo_urls || [];

                                return (
                                  <li
                                    key={commit.id || idx}
                                    className="relative pl-6 border-l-2 border-slate-700 last:border-transparent pb-4 space-y-1.5"
                                  >
                                    {/* Circle marker */}
                                    <span
                                      className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                                        isCur
                                          ? 'bg-indigo-400 shadow-xs shadow-indigo-400'
                                          : isFail
                                          ? 'bg-rose-500'
                                          : 'bg-slate-500'
                                      }`}
                                    />

                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <span className="font-mono text-[11px] text-indigo-300 font-bold mr-2">
                                          {commit.id || `c${idx + 1}`}
                                        </span>
                                        <strong className="text-xs text-white">
                                          {commit.actor || 'You'} · {commit.summary || 'Snapshot update'}
                                        </strong>
                                      </div>
                                      <span className="text-[10px] text-white/50 font-mono">
                                        {commit.at ? commit.at.slice(0, 16).replace('T', ' ') : ''}
                                      </span>
                                    </div>

                                    {commit.attempt && (
                                      <div className="text-[11px] font-mono text-white/80 bg-black/40 p-2 rounded-lg border border-white/10">
                                        <span className={isFail ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                                          {isFail ? 'BURN: ' : 'PASS: '}
                                        </span>
                                        {commit.attempt.hyp} ({commit.attempt.file}) · {commit.attempt.result}
                                        {commit.attempt.note ? ` — ${commit.attempt.note}` : ''}
                                      </div>
                                    )}

                                    <div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOpenSnapCommitIds((prev) => ({
                                            ...prev,
                                            [commit.id || `c${idx}`]: !prev[commit.id || `c${idx}`],
                                          }))
                                        }
                                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-white/10 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>{snapOpen ? 'Hide this snap' : 'View this snap'}</span>
                                      </button>
                                    </div>

                                    {/* Snap Evidence Panel */}
                                    {snapOpen && (
                                      <div className="p-3 bg-slate-950/80 rounded-xl border border-white/10 space-y-2 text-xs">
                                        {/* Clickable photos list */}
                                        {photos.length > 0 ? (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-white/60 block mb-1.5">
                                              Clickable Evidence Photos ({photos.length})
                                            </span>
                                            <div className="flex gap-2 flex-wrap">
                                              {photos.map((p, pIdx) => (
                                                <div
                                                  key={pIdx}
                                                  onClick={() =>
                                                    setLightboxImage({
                                                      url: evidencePhotoSrc(selectedTag.id, p),
                                                      caption: `Photo ${pIdx + 1} for ${commit.id || 'snap'}`,
                                                    })
                                                  }
                                                  className="w-20 h-20 rounded-xl bg-slate-800 border-2 border-indigo-500/40 hover:border-indigo-400 overflow-hidden cursor-pointer relative group flex items-end p-1 shadow-sm transition-transform active:scale-95"
                                                >
                                                  <img
                                                    src={evidencePhotoSrc(selectedTag.id, p)}
                                                    alt="evidence"
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                  />
                                                  <span className="relative text-[9px] font-bold bg-black/70 text-white px-1 rounded z-10">
                                                    {pIdx + 1}/{photos.length}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}

                                        {/* Debug and Log Toggle Buttons */}
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          {evidence?.job_id && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenPreBlocks((prev) => ({
                                                  ...prev,
                                                  [`${commit.id}_dbg`]: !prev[`${commit.id}_dbg`],
                                                }))
                                              }
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-900 cursor-pointer"
                                            >
                                              Debug {evidence.job_id}
                                            </button>
                                          )}

                                          {(evidence?.browser_log || evidence?.last_actions) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenPreBlocks((prev) => ({
                                                  ...prev,
                                                  [`${commit.id}_act`]: !prev[`${commit.id}_act`],
                                                }))
                                              }
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-800 text-white/80 border border-white/10 hover:bg-slate-700 cursor-pointer"
                                            >
                                              Browser + last actions
                                            </button>
                                          )}
                                        </div>

                                        {/* Pre blocks */}
                                        {openPreBlocks[`${commit.id}_dbg`] && (
                                          <pre className="p-2.5 bg-black/70 text-indigo-200 text-[10px] font-mono rounded-lg border border-indigo-500/30 overflow-x-auto whitespace-pre-wrap">
                                            {JSON.stringify(evidence, null, 2)}
                                          </pre>
                                        )}

                                        {openPreBlocks[`${commit.id}_act`] && (
                                          <pre className="p-2.5 bg-black/70 text-white/90 text-[10px] font-mono rounded-lg border border-white/10 overflow-x-auto whitespace-pre-wrap">
                                            {evidence?.last_actions || evidence?.browser_log || '(No actions recorded)'}
                                          </pre>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })
                            )}
                          </ul>
                        </div>

                        {/* Linked Reports List */}
                        {selectedReports.length > 0 && (
                          <div className="space-y-2 border-t border-white/10 pt-3">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                              Linked Reports & Evidence Packs ({selectedReports.length})
                            </h3>
                            <div className="space-y-2">
                              {selectedReports.map((rep: any) => (
                                <div
                                  key={rep.id}
                                  className="p-3 bg-slate-900/90 rounded-xl border border-white/10 flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-white truncate">
                                      {rep.dish_query || rep.user_note || `Report ${rep.id.slice(0, 8)}`}
                                    </div>
                                    <div className="text-[10px] text-white/50 mt-0.5">
                                      {rep.created_at ? rep.created_at.slice(0, 16).replace('T', ' ') : ''} ·{' '}
                                      {rep.shot_count || 0} screenshot(s) {rep.obsolete ? '· (obsolete)' : ''}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        viewTextArtifact(selectedTag.id, rep.reportId || rep.id, 'payload.json')
                                      }
                                      className="px-2 py-1 text-[10px] rounded-lg bg-slate-800 text-white/80 hover:bg-slate-700"
                                    >
                                      Payload
                                    </button>
                                    {!rep.obsolete && (
                                      <button
                                        type="button"
                                        onClick={() => pruneReport(selectedTag.id, rep.id)}
                                        className="px-2 py-1 text-[10px] rounded-lg bg-rose-950/60 text-rose-300 border border-rose-500/30 hover:bg-rose-900/80"
                                      >
                                        Prune R2
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
          </div>

          {/* Lightbox Modal */}
          {lightboxImage && (
            <div
              onClick={() => setLightboxImage(null)}
              className="fixed inset-0 z-[10100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-w-3xl max-h-[85vh] bg-[#111827] border border-white/20 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="p-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-bold text-white">{lightboxImage.caption || 'Evidence Snapshot'}</span>
                  <button
                    onClick={() => setLightboxImage(null)}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/70"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 overflow-auto flex items-center justify-center bg-black/60">
                  <img
                    src={lightboxImage.url}
                    alt="evidence enlarged"
                    className="max-h-[70vh] max-w-full object-contain rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Text Artifact Viewer Modal */}
          {viewingArtifact && (
            <div
              onClick={() => setViewingArtifact(null)}
              className="fixed inset-0 z-[10100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl max-h-[85vh] bg-[#111827] border border-white/20 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="p-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-bold font-mono text-indigo-300">{viewingArtifact.name}</span>
                  <button
                    onClick={() => setViewingArtifact(null)}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/70"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-white/90 overflow-auto bg-black/50 flex-1 whitespace-pre-wrap">
                  {viewingArtifact.content}
                </pre>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
