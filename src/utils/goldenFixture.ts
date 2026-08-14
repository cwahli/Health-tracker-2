/**
 * Collect the original meal prompt + photos from the job the user already ran.
 * Used when snapshotting a golden so they never re-type or re-upload.
 */
import { ImageStore } from '../jobs/ImageStore';

export type GoldenFixture = {
  query: string;
  photos: string[];
  photoUrl?: string | null;
  mode?: string | null;
  jobId?: string | null;
};

function jobTimeMs(j: any): number {
  const parsed = Date.parse(j?.updatedAt || j?.startedAt || j?.finishedAt || j?.createdAt || '');
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const m = String(j?.id || '').match(/job_(\d+)/);
  if (m) return Number(m[1]);
  return 0;
}

/**
 * Always the most recent food job.
 * An old stalled/429 job must not beat a meal you just finished.
 */
export function pickSnapshotJob(jobs: any[], explicitId?: string | null): any | null {
  const list = Array.isArray(jobs) ? jobs : [];
  if (explicitId) {
    const hit = list.find((j) => j?.id === explicitId);
    if (hit) return hit;
  }
  const food = list.filter(
    (j) => j && j.kind !== 'bug_triage' && !String(j.id || '').startsWith('triage_') && !String(j.id || '').startsWith('bug_triage_')
  );
  const pool = food.length ? food : list;
  return (
    [...pool].sort((a, b) => {
      const tb = jobTimeMs(b);
      const ta = jobTimeMs(a);
      if (tb !== ta) return tb - ta;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })[0] || null
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function asStoredPhoto(img: string | Blob): Promise<string | null> {
  if (typeof img === 'string') {
    const s = img.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s) || s.startsWith('data:image')) return s;
    return null;
  }
  if (img instanceof Blob) {
    try {
      return await blobToDataUrl(img);
    } catch {
      return null;
    }
  }
  return null;
}

export async function collectOriginalFixture(job: any): Promise<GoldenFixture> {
  const query = String(
    job?.inputSnapshot?.text ||
      job?.inputSnapshot?.message ||
      job?.result?.userMessage ||
      ''
  ).trim();

  const fromRefs: string[] = [];
  const refs = [
    ...(Array.isArray(job?.inputSnapshot?.imageRefs) ? job.inputSnapshot.imageRefs : []),
    job?.photoUrl,
    job?.result?.photoUrl,
    ...(Array.isArray(job?.result?.imageUrls) ? job.result.imageUrls : []),
    ...(Array.isArray(job?.result?.photos) ? job.result.photos : []),
  ].filter(Boolean);

  for (const r of refs) {
    if (typeof r === 'string' && (/^https?:\/\//i.test(r) || r.startsWith('data:image'))) {
      fromRefs.push(r);
    }
  }

  let fromStore: string[] = [];
  if (job?.id) {
    try {
      const stored = await ImageStore.getImages(job.id);
      const converted = await Promise.all(stored.map(asStoredPhoto));
      fromStore = converted.filter((x): x is string => !!x);
    } catch {
      /* IndexedDB miss is fine if R2 urls exist */
    }
  }

  const photos = [...fromStore, ...fromRefs].filter((v, i, a) => a.indexOf(v) === i);

  return {
    query,
    photos,
    photoUrl: job?.photoUrl || job?.result?.photoUrl || photos.find((p) => /^https?:\/\//i.test(p)) || null,
    mode: job?.mode || job?.kind || null,
    jobId: job?.id || null,
  };
}
