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
