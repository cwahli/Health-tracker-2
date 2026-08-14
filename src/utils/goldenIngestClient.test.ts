import { describe, it, expect } from 'vitest';
import { r2KeyFromPhotoRef, sameOriginPhotoUrl } from './goldenIngestClient';

describe('golden photo proxy keys', () => {
  it('keeps golden/ and photos/ object keys', () => {
    expect(
      r2KeyFromPhotoRef(
        'https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/golden/c9c38c43-c1a0-4eb3-aba4-32084d4edeeb/photos/1.jpg'
      )
    ).toBe('golden/c9c38c43-c1a0-4eb3-aba4-32084d4edeeb/photos/1.jpg');
    expect(
      r2KeyFromPhotoRef('https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/photos/job_1786652199365_x1im90hgm_0.jpg')
    ).toBe('photos/job_1786652199365_x1im90hgm_0.jpg');
  });

  it('rewrites to a same-origin proxy', () => {
    const u = sameOriginPhotoUrl(
      'https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/golden/abc/photos/0.jpg'
    );
    expect(u).toBe('/api/golden/photo?key=golden%2Fabc%2Fphotos%2F0.jpg');
  });
});
