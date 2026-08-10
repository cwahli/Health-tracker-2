import { describe, it, expect } from 'vitest';
import {
  isUsableImageUrl,
  normalizeMealImageUrl,
  photoKeyFromUrl,
  nextPhotoFallbackUrl,
  PHOTO_PROXY_PREFIX,
} from './foodImageSources';

describe('foodImageSources B11d', () => {
  it('rewrites r2.dev public URLs to same-origin proxy', () => {
    const u = normalizeMealImageUrl(
      'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/photos/job_123.jpg'
    );
    expect(u).toBe('/photos/job_123.jpg');
  });

  it('keeps /photos/ proxy paths', () => {
    expect(normalizeMealImageUrl('/photos/abc.jpg')).toBe('/photos/abc.jpg');
  });

  it('photoKeyFromUrl extracts key', () => {
    expect(photoKeyFromUrl('/photos/job_1.jpg')).toBe('job_1.jpg');
    expect(photoKeyFromUrl('https://x.r2.dev/photos/job_2')).toBe('job_2.jpg');
  });

  it('nextPhotoFallbackUrl tries proxy after public URL fails', () => {
    const tried = new Set<string>();
    const next = nextPhotoFallbackUrl(
      'https://pub-xxx.r2.dev/photos/job_99.jpg',
      tried
    );
    expect(next).toBeTruthy();
    expect(String(next).startsWith(PHOTO_PROXY_PREFIX) || String(next).includes('photo-url')).toBe(
      true
    );
  });

  it('rejects placeholders', () => {
    expect(isUsableImageUrl('[image_removed_for_snapshot]')).toBe(false);
  });
});
