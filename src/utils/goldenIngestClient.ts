/**
 * When a food job started from Golden inbox NEW Analyze finishes,
 * push the new tape back onto the case and rescore (old + new bugs).
 */
import { JobStore } from '../jobs/JobStore';

const ingested = new Set<string>();

export const GOLDEN_NEW_ANALYZE_EVENT = 'golden_new_analyze';

export type GoldenNewAnalyzeDetail = {
  caseId: string;
  query: string;
  photos: string[];
  token?: string;
};

export function r2KeyFromPhotoRef(ref: string): string | null {
  const raw = String(ref || '').trim();
  if (!raw || raw.startsWith('data:')) return null;
  if (/^(golden|photos)\//i.test(raw) && !raw.includes('..')) return raw.replace(/^\/+/, '');
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
    const cleaned = path.replace(/^\/+/, '').replace(/\.\./g, '');
    if (/^(golden|photos)\//i.test(cleaned)) return cleaned;
  } catch {
    /* ignore */
  }
  return null;
}

/** Same-origin URL so the browser never talks to r2.dev (CORS). */
export function sameOriginPhotoUrl(ref: string): string {
  if (!ref) return ref;
  if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('/api/golden/photo')) return ref;
  const key = r2KeyFromPhotoRef(ref);
  if (key) return `/api/golden/photo?key=${encodeURIComponent(key)}`;
  return ref;
}

export async function fetchPhotosAsDataUrls(refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    if (typeof ref === 'string' && ref.startsWith('data:image')) {
      out.push(ref);
      continue;
    }
    const href = sameOriginPhotoUrl(ref);
    const r = await fetch(href);
    if (!r.ok) throw new Error(`Could not load saved photo (${r.status})`);
    const blob = await r.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('photo read failed'));
      reader.readAsDataURL(blob);
    });
    if (!dataUrl.startsWith('data:image')) throw new Error('Saved photo was not an image');
    out.push(dataUrl);
  }
  return out;
}

let lastAnalyzeToken = '';

export function requestGoldenNewAnalyze(detail: GoldenNewAnalyzeDetail) {
  if (typeof window === 'undefined') return;
  const token = `${detail.caseId}:${Date.now()}`;
  lastAnalyzeToken = token;
  window.dispatchEvent(new CustomEvent(GOLDEN_NEW_ANALYZE_EVENT, { detail: { ...detail, token } }));
}

export function consumeGoldenAnalyzeToken(token?: string): boolean {
  if (!token || token !== lastAnalyzeToken) return false;
  lastAnalyzeToken = '';
  return true;
}

async function ingestJob(caseId: string, job: any) {
  const foodLog = job?.result?.pendingFoodLog || job?.result?.data || job?.result?.foodLog || null;
  const scout =
    job?.result?.scoutItems ||
    job?.result?.clean_result?.scoutItems ||
    job?.result?.data?.scoutItems ||
    foodLog?.scoutItems ||
    null;
  const logText = String(
    job?.result?.backendLogs ||
      job?.liveThoughts?.backendLogs ||
      job?.result?.agentResult?.backendLogs ||
      ''
  );
  const errorText = String(job?.error?.message || job?.result?.error || '');
  if (!foodLog && logText.trim().length < 400) {
    console.warn('[golden-ingest] skip thin job', job.id);
    return;
  }
  await fetch(`/api/golden/cases/${caseId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId: job.id,
      foodLog,
      scout,
      logText,
      errorText,
      jobStatus: job.status,
    }),
  });
}

export function startGoldenIngestWatcher() {
  if (typeof window === 'undefined') return () => {};
  const tick = () => {
    for (const job of JobStore.getAllJobs()) {
      const caseId = (job as any)?.inputSnapshot?.goldenCaseId;
      if (!caseId || ingested.has(job.id)) continue;
      if (job.status !== 'succeeded' && job.status !== 'failed') continue;
      ingested.add(job.id);
      ingestJob(String(caseId), job).catch((e) => {
        console.warn('[golden-ingest] failed', e);
        ingested.delete(job.id);
      });
    }
  };
  tick();
  return JobStore.subscribe(tick);
}
