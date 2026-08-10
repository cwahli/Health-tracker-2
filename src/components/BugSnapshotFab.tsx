/**
 * Floating bug snapshot control (admin-only).
 * Multi-shot capture → assign bug tag → R2 /bugs/ pack via POST /api/bugs/snapshot
 */
import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, Plus, Trash2, Bug, Loader, Check, ImagePlus, CheckCircle2, Sparkles } from 'lucide-react';
import {
  isBugSnapshotEnabled,
  setBugSnapshotEnabled,
  isBugAutoTriageEnabled,
  setBugAutoTriageEnabled,
  buildSimplifiedDom,
  buildAccessibilityTree,
  initBrowserLogRecorder,
  getBrowserLogBuffer,
  initNetworkRecorder,
  getRecentNetworkEntries,
  getNetworkFailureCount,
  initInteractionRecorder,
  getInteractionRing,
  formatInteractionRing,
  recordTabInteraction,
  captureBugEnv,
  saveBugSnapshotDraft,
  loadBugSnapshotDraft,
  clearBugSnapshotDraft,
  compressToWebpOrJpeg,
  scrubPiiText,
  buildCaptureChecklist,
  BUG_SNAPSHOT_MAX_SHOTS,
  BUG_SNAPSHOT_LOG,
  AGENT_STRUCTURE_DEFAULT,
} from '../utils/bugSnapshot';
import { resolveDomainPack } from '../utils/bugDomainPacks';
import { compressImage } from '../utils/imageCompressor';
import { CATEGORY_OPTIONS, saveBugTrackerCache } from './FlagIssueModal';
import { BugCategory } from '../utils/issueBacklog';
import { AVAILABLE_LLMS } from '../utils/llm';
import { JobStore } from '../jobs/JobStore';
import { saveAgentRequestLog } from '../utils/agentLogsTracker';

export interface BugSnapshotFabProps {
  isAdmin: boolean;
  firebaseUid?: string | null;
  /** Active page / tab identifier to auto-select */
  activeTab?: string;
  /** Optional: active job context for modal payloads */
  getModalContext?: () => Promise<Record<string, unknown>> | Record<string, unknown> | null;
  biomarkerHistory?: any[];
  biomarkers?: any;
  profile?: any;
}

export function getCategoryForTab(tab?: string): BugCategory {
  if (!tab) return 'Home';
  const lower = tab.toLowerCase();
  if (lower === 'home') return 'Home';
  if (lower === 'food') return 'foodcart';
  if (
    lower === 'biomarker' ||
    lower === 'medical' ||
    lower === 'health' ||
    lower === 'insights' ||
    lower === 'trends'
  ) {
    return 'biomarker';
  }
  if (lower === 'database') return 'database';
  return 'Home';
}

async function capturePageScreenshot(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  // 1. Native Screen Capture API (getDisplayMedia) — pixel-perfect, no CSS parsing issues.
  try {
    const mediaDevices = navigator.mediaDevices as any;
    if (mediaDevices?.getDisplayMedia) {
      const stream = await mediaDevices.getDisplayMedia({
        video: { mediaSource: 'tab', displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
      } as any);
      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();
      track.stop();
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

      // Draw the frame to a canvas and export to JPEG
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        return await compressImage(dataUrl, 1280, 1280, 0.82);
      }
    }
  } catch (err) {
    console.warn(`${BUG_SNAPSHOT_LOG} getDisplayMedia capture failed, trying html-to-image fallback`, err);
  }

  // 2. html-to-image fallback with window scroll translation for mobile/scrolled viewports
  try {
    const { toJpeg } = await import('html-to-image');
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const dataUrl = await toJpeg(document.body, {
      quality: 0.72,
      pixelRatio: 1,
      cacheBust: true,
      skipFonts: true,
      width,
      height,
      style: {
        transform: `translate(-${scrollX}px, -${scrollY}px)`,
        transformOrigin: 'top left',
      },
      filter: (node) => {
        if (
          node instanceof HTMLElement &&
          (node.id === 'bug-snapshot-fab' ||
            node.classList?.contains('bug-snapshot-ignore') ||
            node.classList?.contains('bug-modal'))
        ) {
          return false;
        }
        return true;
      },
    });
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      return await compressImage(dataUrl, 1280, 1280, 0.72);
    }
  } catch (err) {
    console.warn(`${BUG_SNAPSHOT_LOG} html-to-image capture failed`, err);
  }

  // 3. Canvas-based fallback
  try {
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('[Screenshot viewport capture fallback]', 24, 48);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`URL: ${window.location.href}`, 24, 80);
      ctx.fillText(`Time: ${new Date().toISOString()}`, 24, 104);
      ctx.fillText(`Viewport: ${window.innerWidth} × ${window.innerHeight}`, 24, 128);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      return await compressImage(dataUrl, 1280, 1280, 0.75);
    }
  } catch {
    /* ignore */
  }

  return null;
}


export default function BugSnapshotFab({
  isAdmin,
  firebaseUid,
  activeTab,
  getModalContext,
  biomarkerHistory,
  biomarkers,
  profile,
}: BugSnapshotFabProps) {
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [category, setCategory] = useState<BugCategory>(getCategoryForTab(activeTab));
  const [tagId, setTagId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [symptom, setSymptom] = useState('');
  const [bugTags, setBugTags] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<string>('');
  const [lastTriageJobId, setLastTriageJobId] = useState<string | null>(null);

  // Requirement 7: User-controlled sharing checkboxes
  const [sendChecklist, setSendChecklist] = useState({
    a11y: true,
    overview: true,
    sessionData: true,
    photo: true,
    nutrientCalculation: true,
    debugJson: true,
  });

  useEffect(() => {
    initBrowserLogRecorder();
    initNetworkRecorder();
    initInteractionRecorder();
    setEnabled(isBugSnapshotEnabled());
    const onStorage = () => setEnabled(isBugSnapshotEnabled());
    window.addEventListener('bug_snapshot_settings_changed', onStorage);
    return () => window.removeEventListener('bug_snapshot_settings_changed', onStorage);
  }, []);

  // Update pre-selected category whenever activeTab changes if modal is not currently open
  useEffect(() => {
    if (!open) {
      setCategory(getCategoryForTab(activeTab));
    }
    if (activeTab) recordTabInteraction(activeTab);
  }, [activeTab, open]);

  // Restore draft when opening
  useEffect(() => {
    if (!open) return;
    const draft = loadBugSnapshotDraft();
    if (!draft) return;
    if (draft.category) setCategory(draft.category as BugCategory);
    if (draft.tagId) setTagId(draft.tagId);
    if (draft.newTitle) setNewTitle(draft.newTitle);
    if (draft.symptom) setSymptom(draft.symptom);
    if (Array.isArray(draft.shots) && draft.shots.length && draft.shots[0]?.startsWith('data:image')) {
      setShots((prev) => (prev.length ? prev : draft.shots!.filter((s) => s.startsWith('data:image'))));
    }
  }, [open]);

  // Persist draft while editing
  useEffect(() => {
    if (!open) return;
    saveBugSnapshotDraft({ category, tagId, newTitle, symptom, shots });
  }, [open, category, tagId, newTitle, symptom, shots]);

  // Paste images (Cmd/Ctrl+V)
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        e.preventDefault();
        addShotsFromFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, shots.length]);

  const loadTags = useCallback(() => {
    fetch('/api/bug-tracker/overview')
      .then((r) => r.json())
      .then((data) => {
        if (data?.bugTags) {
          setBugTags(data.bugTags);
          saveBugTrackerCache(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  if (!isAdmin || !enabled) return null;

  const normalizeCat = (c: string) => (c || 'foodcart').toLowerCase();
  const pageTags = bugTags.filter(
    (t) => normalizeCat(t.category) === normalizeCat(category) && t.status !== 'fixed'
  );
  const otherTags = bugTags.filter(
    (t) => normalizeCat(t.category) !== normalizeCat(category) && t.status !== 'fixed'
  );

  // Requirement 3: Support adding multiple screenshots at the same time
  const addShotsFromFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;
    const remainingSlots = BUG_SNAPSHOT_MAX_SHOTS - shots.length;
    if (remainingSlots <= 0) return;
    const toProcess = fileArray.slice(0, remainingSlots);

    try {
      const newShots: string[] = [];
      for (const f of toProcess) {
        const dataUrl = await compressImage(f, 1280, 1280, 0.8);
        const webp = await compressToWebpOrJpeg(dataUrl, 1280, 0.8);
        newShots.push(webp);
      }
      setShots((s) => [...s, ...newShots].slice(0, BUG_SNAPSHOT_MAX_SHOTS));
    } catch (e: any) {
      setError(e?.message || 'Failed to read image(s)');
    }
  };

  /** Requirement 2: Open modal immediately, then close shortly to get picture and show it again */
  const handleOpenFab = async () => {
    setCategory(getCategoryForTab(activeTab));
    setTagId('');
    setError(null);
    setSuccess(null);
    setCapturing(true);

    // 1. Open modal immediately
    setOpen(true);
    loadTags();

    // 2. Wait briefly so user sees modal open
    await new Promise((r) => setTimeout(r, 150));

    // 3. Briefly close modal to take clean screen capture
    setOpen(false);
    await new Promise((r) => setTimeout(r, 100));

    try {
      const frame = await capturePageScreenshot();
      if (frame) {
        const webp = await compressToWebpOrJpeg(frame, 1280, 0.8);
        setShots([webp]);
      } else {
        setShots([]);
      }
    } catch {
      setShots([]);
    } finally {
      setCapturing(false);
      // 4. Reopen modal with captured shot
      setOpen(true);
    }
  };

  const handleCaptureScreen = async () => {
    setCapturing(true);
    setError(null);
    try {
      setOpen(false);
      await new Promise((r) => setTimeout(r, 200)); // extra frame for modal close animation
      const frame = await capturePageScreenshot();
      setOpen(true);
      if (!frame) {
        setError('Screen capture cancelled or unavailable. Use \"Add image\" to paste (⌘V) or upload a screenshot.');
      } else {
        setShots((s) => [...s, frame].slice(0, BUG_SNAPSHOT_MAX_SHOTS));
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (tagId === 'new_bug' && !newTitle.trim()) {
        throw new Error('Enter a title for the new bug');
      }
      if (!tagId) throw new Error('Select a bug tag or create new');
      if (shots.length === 0) throw new Error('Add at least one screenshot');

      let payload: any = {};
      if (getModalContext) {
        try {
          payload = (await Promise.resolve(getModalContext())) || {};
        } catch {
          payload = {};
        }
      }
      // Prefer live agent logs from local tracker if present
      let logs = '';
      try {
        const raw = localStorage.getItem('agent_live_logs_hot') || localStorage.getItem('agent_logs_hot');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            logs = parsed
              .slice(-200)
              .map((l: any) => (typeof l === 'string' ? l : l?.message || JSON.stringify(l)))
              .join('\n');
          } else if (typeof parsed === 'string') logs = parsed;
        }
      } catch {
        /* ignore */
      }
      if (payload.backendLogs) logs = String(payload.backendLogs) + (logs ? '\n' + logs : '');

      // Prefer focused dialog for a11y (all agents default structure)
      const a11yRoot =
        typeof document !== 'undefined'
          ? document.querySelector('[data-unified-modal], [role="dialog"]') || document.body
          : null;
      const a11y = buildAccessibilityTree(a11yRoot);
      const dom = buildSimplifiedDom(); // cold fallback only
      const browserLogs = getBrowserLogBuffer();
      const network = getRecentNetworkEntries();
      const jobs = typeof JobStore?.getAllJobs === 'function' ? JobStore.getAllJobs() : [];

      // Exclude internal bug_triage jobs — they exist only in local JobStore and
      // carry no food/biomarker debug data. Sort remaining descending by ID (timestamp-based).
      const FOOD_KINDS = ['food_log', 'food_review', 'food_edit', 'food', 'biomarker', 'review'];
      const contextJobId = (payload as any)?.jobId || null;
      const foodJobs = jobs
        .filter((j) => j.kind !== 'bug_triage')
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const allSorted = [...jobs].sort((a, b) => String(b.id).localeCompare(String(a.id)));

      const activeJob =
        // 1. Explicit job from modal context (most reliable)
        (contextJobId ? jobs.find((j) => j.id === contextJobId) : null) ||
        // 2. Running food/biomarker job
        foodJobs.find((j) => j.status === 'running') ||
        // 3. Most recently succeeded or failed food/biomarker job
        foodJobs.find((j) => j.status === 'succeeded' || j.status === 'failed') ||
        // 4. Any non-bug_triage job (most recent)
        foodJobs[0] ||
        // 5. Absolute fallback (won't be a triage job if food ones exist)
        allSorted[0];

      let debug_payload: any = null;
      let nutrition_table_md = '';
      let meal_file_name = 'nutrition_table.md';

      if (activeJob) {
        try {
          const { buildDebugMarkdownReport, debugReportFromJobMsg, stripHeavyImages } = await import('../utils/debugPayload');

          // Only fetch cold R2 debug data for real food/biomarker jobs that exist in Supabase.
          // bug_triage and other local-only jobs are not stored in agent_jobs table.
          const isSupabaseJob =
            activeJob.kind !== 'bug_triage' &&
            !String(activeJob.id).startsWith('triage_') &&
            !String(activeJob.id).startsWith('bug_triage_');

          let fullJobData: any = null;
          if (isSupabaseJob) {
            try {
              const uid = (payload as any)?.firebaseUid || firebaseUid || 'anonymous';
              const dbgRes = await fetch(
                `/api/jobs/debug?jobId=${encodeURIComponent(activeJob.id)}&userId=${encodeURIComponent(uid)}`
              );
              if (dbgRes.ok) fullJobData = await dbgRes.json().catch(() => null);
              else console.warn(`[BugSnapshot] /api/jobs/debug returned ${dbgRes.status} for job=${activeJob.id}`);
            } catch (fetchErr) {
              console.warn('[BugSnapshot] /api/jobs/debug fetch failed, using local job:', fetchErr);
            }
          }

          const jobForReport = fullJobData || activeJob;

          const resolvedFoodLog =
            fullJobData?.result?.pendingFoodLog ||
            fullJobData?.result?.data?.pendingFoodLog ||
            fullJobData?.pendingFoodLog ||
            activeJob.result?.pendingFoodLog ||
            activeJob.result?.data?.pendingFoodLog ||
            activeJob.result?.raw?.data ||
            activeJob.messages?.slice().reverse().find((m: any) => m.pendingFoodLog || m.data?.pendingFoodLog)?.pendingFoodLog ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
            (payload as any)?.pendingFoodLog ||
            null;

          const resolvedScoutItems =
            fullJobData?.result?.scoutItems ||
            fullJobData?.scoutItems ||
            activeJob.result?.scoutItems ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.scoutItems || m.scoutItems)?.data?.scoutItems ||
            (payload as any)?.scoutItems ||
            [];

          const resolvedReceipt =
            resolvedFoodLog?.receiptTable ||
            fullJobData?.result?.receiptTable ||
            activeJob.result?.receiptTable ||
            (payload as any)?.receiptTable ||
            [];

          const resolvedBackendLogs =
            fullJobData?.backendLogs ||
            fullJobData?.result?.backendLogs ||
            activeJob.result?.backendLogs ||
            activeJob.liveThoughts?.backendLogs ||
            (payload as any)?.backendLogs ||
            '';

          debug_payload = stripHeavyImages({
            jobId: activeJob.id,
            kind: activeJob.kind,
            status: activeJob.status,
            inputSnapshot: activeJob.inputSnapshot,
            result: fullJobData?.result || activeJob.result,
            messages: activeJob.messages,
            liveThoughts: activeJob.liveThoughts,
            progressPercent: activeJob.progressPercent,
            attemptByStep: activeJob.attemptByStep,
            error: activeJob.error,
            backendLogs: resolvedBackendLogs,
            pipelineErrors: fullJobData?.result?.pipelineErrors || activeJob.result?.pipelineErrors,
            scoutItems: resolvedScoutItems,
            pendingFoodLog: resolvedFoodLog,
            receiptTable: resolvedReceipt,
            exportedAt: new Date().toISOString(),
          });

          const lastMsg = activeJob.messages?.[activeJob.messages.length - 1];
          const reportInput = debugReportFromJobMsg(jobForReport, lastMsg);
          nutrition_table_md = buildDebugMarkdownReport({
            ...reportInput,
            pendingFoodLog: resolvedFoodLog || reportInput.pendingFoodLog,
            scoutItems: resolvedScoutItems.length > 0 ? resolvedScoutItems : reportInput.scoutItems,
            receiptTable: resolvedReceipt.length > 0 ? resolvedReceipt : reportInput.receiptTable,
            backendLogs: resolvedBackendLogs || reportInput.backendLogs,
          });

          const mealName =
            resolvedFoodLog?.name ||
            (payload as any)?.dish_query ||
            (payload as any)?.query ||
            reportInput.pendingFoodLog?.name ||
            activeJob.inputSnapshot?.text ||
            activeJob.id;
          const safeMeal = String(mealName)
            .replace(/[^a-zA-Z0-9_\- ]/g, '')
            .trim()
            .slice(0, 60);
          meal_file_name = safeMeal ? `${safeMeal}.md` : `report-${activeJob.id}.md`;
        } catch (repErr) {
          console.warn('[BugSnapshot] Report generation skipped:', repErr);
        }
      }

      const domain_pack = resolveDomainPack({
        category,
        activeTab,
        jobs,
        payload,
        biomarkerHistory,
        biomarkers,
        profile,
      });
      const env = captureBugEnv({
        activeJobId:
          (payload as any)?.jobId ||
          activeJob?.id ||
          domain_pack.food?.jobId ||
          domain_pack.biomarker?.jobId ||
          null,
        activeMode: (payload as any)?.mode || activeJob?.kind || domain_pack.food?.mode || null,
        modelId: localStorage.getItem('selectedModelId'),
      });

      const interactions = formatInteractionRing();
      const combinedLogs = scrubPiiText(
        [
          logs,
          browserLogs ? `=== BROWSER CONSOLE LOGS ===\n${browserLogs}` : '',
          interactions ? `=== INTERACTIONS (last ${getInteractionRing().length}) ===\n${interactions}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      );

      const check = buildCaptureChecklist({
        a11y: !!a11y?.textOutline,
        domainPack: !!domain_pack,
        shots: shots.length,
        logs: !!combinedLogs,
        networkFails: getNetworkFailureCount(),
        interactions: getInteractionRing().length,
      });
      setChecklist(check);

      const autoTriage = isBugAutoTriageEnabled();
      const body = {
        category,
        tag_id: tagId === 'new_bug' ? undefined : tagId,
        new_bug_title: tagId === 'new_bug' ? newTitle.trim() : undefined,
        user_symptom: symptom.trim() || undefined,
        shots,
        payload: {
          ...payload,
          debug_payload,
          debug_job: debug_payload,
          nutrition_table_md,
          meal_file_name,
          domain_pack,
          structure_default: AGENT_STRUCTURE_DEFAULT,
          interactions: getInteractionRing().slice(-50),
        },
        debug_payload,
        nutrition_table_md,
        meal_file_name,
        domain_pack,
        logs: combinedLogs,
        dom,
        a11y,
        network,
        env,
        firebase_uid: firebaseUid || undefined,
        dish_query:
          (payload as any)?.dish_query ||
          (payload as any)?.query ||
          domain_pack.food?.mealName ||
          undefined,
        chain_key: (payload as any)?.chain_key || undefined,
        auto_triage: autoTriage,
        modelId: localStorage.getItem('selectedModelId') || 'gemini-3.5-flash-lite',
      };

      const res = await fetch('/api/bugs/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // Save directly to AI Agent Diagnostic Log History
      try {
        const logEntries: any[] = [
          {
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] User symptom: ${symptom || '(none provided)'}`,
          },
          {
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Uploaded ${shots.length} screenshot(s), a11y tree outline, slim DOM, and network activity on category "${category}".`,
          },
        ];

        if (activeJob) {
          const debugFileName = `debug-${activeJob.id}.json`;
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Active Job: ${activeJob.id} (status=${activeJob.status || 'unknown'}, kind=${activeJob.kind || 'food'})`,
          });
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: [
              `[BugSnapshot] Files captured for agent:`,
              `  • ${debugFileName}  ← full debug JSON payload`,
              nutrition_table_md ? `  • ${meal_file_name}  ← nutrition calculation table` : '  • (no nutrition table — job may have no result)',
              `  • overview.md  ← a11y + domain pack briefing`,
            ].join('\n'),
          });
        }
        if (nutrition_table_md) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Nutrition Calculation & Receipt Table (${meal_file_name}):\n${nutrition_table_md}`,
          });
        }
        if (debug_payload) {
          const debugFileName = `debug-${activeJob?.id || 'job'}.json`;
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Full Debug Payload (${debugFileName}):\n${JSON.stringify(debug_payload, null, 2)}`,
          });
        }
        if (combinedLogs) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Live Logs & Browser Trace:\n${combinedLogs}`,
          });
        }
        logEntries.push({
          timestamp: new Date().toLocaleTimeString(),
          message: `[BugSnapshot] Report ${json.reportId || json.id} linked to bug tag "${json.tag_id || tagId}". ${autoTriage ? 'Auto-triage agent is working...' : 'Triage available on demand.'}`,
        });

        saveAgentRequestLog({
          id: `snapshot_${json.tag_id || tagId}_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          summary: `[BugSnapshot] Captured "${newTitle || tagId}" (${category})`,
          logs: logEntries,
        });
        window.dispatchEvent(new Event('agent_logs_updated'));
      } catch (logErr) {
        console.warn('[BugSnapshot] Failed to save log history:', logErr);
      }

      // Durable client job so retry is possible if auto-triage fails
      const triageJobId = json.triage_job_id || null;
      setLastTriageJobId(triageJobId);
      if (autoTriage && json.tag_id) {
        try {
          JobStore.createJob({
            id: triageJobId || `bug_triage_${json.tag_id}_${Date.now()}`,
            kind: 'bug_triage',
            status: triageJobId ? 'running' : 'queued',
            stepIndex: 0,
            stepTotal: 1,
            progressPercent: triageJobId ? 40 : 10,
            statusMessage: triageJobId
              ? 'Auto-triage running (a11y + domain pack)…'
              : 'Snapshot saved; triage not started',
            messages: [],
            inputSnapshot: {
              text: String(json.tag_id),
              imageRefs: [],
              modelId: body.modelId,
              tagId: json.tag_id,
              reportId: json.reportId,
              mode: 'bug_triage',
            } as any,
            attemptByStep: {},
            result: {
              tagId: json.tag_id,
              reportId: json.reportId,
              r2_prefix: json.r2_prefix,
              capture_checklist: json.capture_checklist,
            },
          });
        } catch {
          /* ignore JobStore errors */
        }
      }

      clearBugSnapshotDraft();
      setSuccess(
        `Saved ${String(json.id || '').slice(0, 8)}… · ${check}${
          autoTriage ? ' · triage queued' : ''
        }`
      );
      setShots([]);
      setSymptom('');
      loadTags();
      setTimeout(() => {
        setSuccess(null);
        setOpen(false);
      }, 1600);
    } catch (e: any) {
      setError(e?.message || 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full text-xs rounded-xl px-3 py-2 bg-slate-950/80 border border-white/20 text-white placeholder:text-white/40';

  const currentCategoryLabel =
    CATEGORY_OPTIONS.find((c) => normalizeCat(c.key) === normalizeCat(category))?.label || category;

  return (
    <>
      {createPortal(
        <button
          type="button"
          id="bug-snapshot-fab"
          title="Capture bug snapshot"
          disabled={capturing}
          onClick={handleOpenFab}
          className="fixed right-3 bottom-24 md:right-4 md:bottom-28 z-[80] flex items-center gap-1.5 px-3 py-2.5 rounded-2xl shadow-lg border border-rose-400/40 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all hover:scale-[1.03] disabled:opacity-75"
        >
          {capturing ? <Loader className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          <span className="hidden sm:inline">{capturing ? 'Snapping…' : 'Bug snap'}</span>
        </button>,
        document.body
      )}

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-slate-900 text-white w-full sm:max-w-lg max-h-[92vh] rounded-t-2xl sm:rounded-2xl border border-white/15 shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Bug className="w-4 h-4 text-rose-400" />
                  Bug snapshot
                </div>
                <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
                {error && (
                  <div className="p-2 rounded-lg bg-rose-950/80 border border-rose-500/40 text-rose-200">{error}</div>
                )}
                {success && (
                  <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {success}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    title="Capture screen"
                    disabled={capturing || shots.length >= BUG_SNAPSHOT_MAX_SHOTS}
                    onClick={handleCaptureScreen}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {capturing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                    Capture page
                  </button>
                  <label className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold cursor-pointer flex items-center gap-1.5">
                    <ImagePlus className="w-3.5 h-3.5" />
                    Add image
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addShotsFromFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <span className="text-white/50 self-center">
                    {shots.length}/{BUG_SNAPSHOT_MAX_SHOTS}
                  </span>
                </div>

                {shots.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {shots.map((s, i) => (
                      <div
                        key={i}
                        className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-white/20 cursor-pointer group"
                        onClick={() => setPreviewUrl(s)}
                      >
                        <img src={s} alt={`shot ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          title="Delete shot"
                          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-rose-300 hover:bg-rose-600 hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShots((prev) => prev.filter((_, j) => j !== i));
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="font-bold text-white/90">Page / Category</label>
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value as BugCategory);
                      setTagId('');
                    }}
                    className={inputCls}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-white/90">Bug tag</label>
                  <select
                    value={tagId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTagId(val);
                      if (val && val !== 'new_bug') {
                        const selectedTag = bugTags.find((t) => t.id === val);
                        if (selectedTag?.category) {
                          const match = CATEGORY_OPTIONS.find(
                            (c) => normalizeCat(c.key) === normalizeCat(selectedTag.category)
                          );
                          if (match) setCategory(match.key);
                        }
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="">— Select or create —</option>
                    <option value="new_bug">+ Create new bug…</option>
                    {pageTags.length > 0 && (
                      <optgroup label={`Active bugs for ${currentCategoryLabel}`}>
                        {pageTags.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherTags.length > 0 && (
                      <optgroup label="Other active bugs">
                        {otherTags.map((t) => {
                          const catLabel =
                            CATEGORY_OPTIONS.find(
                              (c) => normalizeCat(c.key) === normalizeCat(t.category)
                            )?.label || t.category || 'Other';
                          return (
                            <option key={t.id} value={t.id}>
                              [{catLabel}] {t.title}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Requirement 5: Selecting bug tag shows previous identified problem */}
                {tagId && tagId !== 'new_bug' && (() => {
                  const selectedTag = bugTags.find((t) => t.id === tagId);
                  if (!selectedTag) return null;
                  const problems = selectedTag.identified_problems || selectedTag.symptom;
                  return (
                    <div className="p-2.5 rounded-xl border border-violet-500/30 bg-violet-950/40 space-y-1 text-xs text-violet-100">
                      <div className="font-bold text-violet-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <span>Previously identified problem:</span>
                      </div>
                      <div className="text-[11px] text-white/90 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
                        {problems || '(No previous problem recorded for this bug tag)'}
                      </div>
                      {selectedTag.whats_still_open && (
                        <div className="text-[10px] text-amber-200/90 pt-1 border-t border-violet-500/20">
                          <span className="font-bold text-amber-300">Still open: </span>
                          {selectedTag.whats_still_open}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {tagId === 'new_bug' && (
                  <div className="space-y-1">
                    <label className="font-bold text-amber-300">New bug title *</label>
                    <input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className={inputCls}
                      placeholder="Short descriptive title"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="font-bold text-white/90">Identified problem / symptom (optional)</label>
                  <textarea
                    rows={2}
                    value={symptom}
                    onChange={(e) => setSymptom(e.target.value)}
                    className={inputCls}
                    placeholder="What looks wrong? (full diagnosis can be filled by Analyze later)"
                  />
                </div>

                {/* Requirements 6 & 7: Cleaned up Capture pack and checkboxes for info sent */}
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/25 p-2.5 space-y-2 text-[11px] text-white/70">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Capture pack data to send to agent</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.a11y}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, a11y: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Accessibility tree</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.overview}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, overview: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Overview & logs</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.sessionData}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, sessionData: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Session data</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.photo}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, photo: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Screenshots ({shots.length})</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.nutrientCalculation}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, nutrientCalculation: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Nutrient calculation</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sendChecklist.debugJson}
                        onChange={(e) => setSendChecklist((s) => ({ ...s, debugJson: e.target.checked }))}
                        className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                      />
                      <span>Debug JSON payload</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-3 border-t border-white/10 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded-xl bg-slate-700 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmit}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold disabled:opacity-40 flex items-center gap-1.5"
                >
                  {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Save to bug tracker
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {previewUrl &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <img
              src={previewUrl}
              alt="shot preview"
              className="max-w-full max-h-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-black/60 text-white hover:bg-black/90"
            >
              <X className="w-5 h-5" />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** Settings toggle rows — embed in Settings panel */
export function BugSnapshotSettingsToggle() {
  const [on, setOn] = useState(isBugSnapshotEnabled());
  const [auto, setAuto] = useState(isBugAutoTriageEnabled());
  return (
    <div className="space-y-2">
      <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-800/50 rounded-2xl flex items-center justify-between shadow-xs">
        <div>
          <p className="text-sm font-bold text-theme-text">Bug snapshot capture</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Floating control to snapshot the page into R2 /bugs/ (admin). Off hides the button.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => {
            const next = !on;
            setOn(next);
            setBugSnapshotEnabled(next);
            window.dispatchEvent(new Event('bug_snapshot_settings_changed'));
          }}
          className={`relative w-12 h-7 rounded-full transition-colors ${on ? 'bg-rose-600' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      <div className="p-3.5 bg-violet-50/70 dark:bg-violet-950/25 border border-violet-200/80 dark:border-violet-800/50 rounded-2xl flex items-center justify-between shadow-xs">
        <div>
          <p className="text-sm font-bold text-theme-text">Auto-triage after snapshot</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Runs Flash-lite on a11y + domain pack after save. Instance stays if the model fails — retry from Bug Tracker.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => {
            const next = !auto;
            setAuto(next);
            setBugAutoTriageEnabled(next);
          }}
          className={`relative w-12 h-7 rounded-full transition-colors ${auto ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${auto ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
    </div>
  );
}
