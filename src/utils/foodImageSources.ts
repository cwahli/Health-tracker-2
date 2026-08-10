/** Tokens that must never be treated as displayable meal photos */
export const UNUSABLE_IMAGE_TOKENS = new Set([
  '[image_removed_for_snapshot]',
  'Image reference preserved',
  'loading',
  'Image reference preserved.',
]);

/** B11d — prefer app proxy so private R2 buckets still load on other devices. */
export const PHOTO_PROXY_PREFIX = '/photos/';
export const PHOTO_PROXY_API = '/api/r2/photos/';

export function isUsableImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || UNUSABLE_IMAGE_TOKENS.has(u)) return false;
  // Explicit token substrings (sometimes embedded in longer placeholder strings)
  if (u.includes('image_removed_for_snapshot')) return false;
  if (u.includes('Image reference preserved')) return false;
  if (u.startsWith('data:image/')) return u.length > 32;
  if (u.startsWith('blob:')) return true;
  // App proxies R2 public URLs as /photos/{key}
  if (u.startsWith('/photos/') && u.length > 9) return true;
  if (u.startsWith('/api/r2/photos/') && u.length > 16) return true;
  if (/^https?:\/\//i.test(u)) return u.length < 2000;
  return false;
}

/**
 * Normalize meal photo URLs for display.
 * B11d: rewrite Cloudflare R2 public URLs → same-origin `/photos/{key}` proxy
 * so multi-device works even when the bucket is private (401 on r2.dev).
 */
export function normalizeMealImageUrl(url: unknown): string | undefined {
  if (!isUsableImageUrl(url)) return undefined;
  let u = url.trim();

  // Strip query/hash for key extraction; keep signed query if already our API
  if (u.startsWith('/api/r2/photos/')) return u;
  if (u.startsWith('/photos/')) {
    // ensure .jpg key form is usable
    return u;
  }

  // https://pub-….r2.dev/photos/jobId.jpg → /photos/jobId.jpg
  const r2Photos = u.match(/\.r2\.dev\/photos\/([^?#]+)/i);
  if (r2Photos?.[1]) {
    return `${PHOTO_PROXY_PREFIX}${r2Photos[1].replace(/^\/+/, '')}`;
  }

  // https://…/photos/jobId.jpg (any host)
  const anyPhotos = u.match(/\/photos\/([^?#]+)/i);
  if (anyPhotos?.[1] && /^https?:\/\//i.test(u)) {
    return `${PHOTO_PROXY_PREFIX}${anyPhotos[1].replace(/^\/+/, '')}`;
  }

  return u;
}

/** Extract R2 object key from a meal photo URL (for signed GET). */
export function photoKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  const m =
    u.match(/\/(?:api\/r2\/)?photos\/([^?#]+)/i) ||
    u.match(/\.r2\.dev\/photos\/([^?#]+)/i);
  if (!m?.[1]) return null;
  let key = m[1].replace(/^\/+/, '');
  if (!key.includes('.')) key = `${key}.jpg`;
  return key.slice(0, 200);
}

/**
 * B11d — if primary URL fails (private R2), try proxy then signed API.
 * Returns next URL to try, or null if exhausted.
 */
export function nextPhotoFallbackUrl(failedUrl: string, tried: Set<string>): string | null {
  const candidates: string[] = [];
  const key = photoKeyFromUrl(failedUrl);
  if (key) {
    candidates.push(`${PHOTO_PROXY_PREFIX}${key}`);
    candidates.push(`${PHOTO_PROXY_API}${key}`);
    candidates.push(`/api/r2/photo-url?key=${encodeURIComponent(key)}`);
  }
  const norm = normalizeMealImageUrl(failedUrl);
  if (norm) candidates.push(norm);

  for (const c of candidates) {
    if (c && !tried.has(c) && c !== failedUrl) return c;
  }
  return null;
}

/**
 * Ordered candidates for a meal/job (first usable wins for primary display).
 * Does NOT invent stock/catalog images.
 */
export function resolveMealImageCandidates(input: {
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  photoUrl?: string | null;
  messageImageUrl?: string | null;
  messageImageUrls?: string[] | null;
}): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const norm = normalizeMealImageUrl(v);
    if (norm && !out.includes(norm)) out.push(norm);
  };
  push(input.photoUrl);
  push(input.imageUrl);
  push(input.messageImageUrl);
  if (Array.isArray(input.imageUrls)) input.imageUrls.forEach(push);
  if (Array.isArray(input.messageImageUrls)) input.messageImageUrls.forEach(push);
  return out;
}

export const IMAGE_PRESERVE_LOG = '[ImagePreserve]';
