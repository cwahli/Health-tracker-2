/**
 * R2 Storage utility for uploading and deleting assets/payloads via API endpoints.
 */

export async function uploadPhotoToR2(
  photoDataOrId: string | Blob,
  optionsOrData?: { prefix?: string; filename?: string } | string,
  index?: number
): Promise<string> {
  try {
    if (typeof photoDataOrId === 'string' && typeof optionsOrData === 'string') {
      const id = photoDataOrId;
      const base64 = optionsOrData;
      const filename = `${id}${typeof index === 'number' && index > 0 ? `_${index}` : ''}.jpg`;
      const res = await fetch('/api/r2/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: id,
          payload: base64,
          data: base64,
          prefix: 'photos',
          filename
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.url || data.publicUrl || data.key || '';
      }
      return base64;
    }

    const photoData = photoDataOrId;
    const options = optionsOrData as { prefix?: string; filename?: string } | undefined;
    const res = await fetch('/api/r2/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: typeof photoData === 'string' ? photoData : await blobToBase64(photoData),
        data: typeof photoData === 'string' ? photoData : await blobToBase64(photoData),
        prefix: options?.prefix || 'photos',
        filename: options?.filename
      })
    });
    if (res.ok) {
      const data = await res.json();
      return data.url || data.publicUrl || data.key || '';
    }
  } catch (err) {
    console.warn('[r2Storage] Photo upload failed, falling back to local data URI:', err);
  }
  if (typeof optionsOrData === 'string' && optionsOrData.length > 0) return optionsOrData;
  if (typeof photoDataOrId === 'string' && (photoDataOrId.startsWith('data:') || photoDataOrId.startsWith('http') || photoDataOrId.startsWith('/photos/'))) return photoDataOrId;
  return (typeof photoDataOrId === 'object' && photoDataOrId !== null && photoDataOrId instanceof Blob) ? URL.createObjectURL(photoDataOrId) : '';
}

export async function uploadPhotosToR2(
  photosOrJobId: (string | Blob)[] | string,
  optionsOrPhotos?: { prefix?: string } | (string | Blob)[]
): Promise<string[]> {
  if (typeof photosOrJobId === 'string' && Array.isArray(optionsOrPhotos)) {
    const jobId = photosOrJobId;
    const photos = optionsOrPhotos;
    return Promise.all(photos.map((p, idx) => uploadPhotoToR2(jobId, typeof p === 'string' ? p : '', idx)));
  }
  const photos = Array.isArray(photosOrJobId) ? photosOrJobId : [];
  const options = optionsOrPhotos as { prefix?: string } | undefined;
  return Promise.all(photos.map(p => uploadPhotoToR2(p, options)));
}

export async function uploadDebugPayloadToR2(jobId: string, payload: any): Promise<string> {
  try {
    const res = await fetch('/api/r2/upload-debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload })
    });
    if (res.ok) {
      const data = await res.json();
      return data.debugUrl || data.url || '';
    }
  } catch (err) {
    console.warn('[r2Storage] uploadDebugPayloadToR2 failed:', err);
  }
  return '';
}

export async function deleteDebugPayloadFromR2(jobIdOrUrl: string, userId?: string): Promise<boolean> {
  if (!jobIdOrUrl) return false;
  try {
    const res = await fetch('/api/debug/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: jobIdOrUrl, userId })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] deleteDebugPayloadFromR2 error:', err);
    return false;
  }
}

export async function uploadLogsToR2(key: string, data: any): Promise<string> {
  try {
    const res = await fetch('/api/r2/upload-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: key, logsText: typeof data === 'string' ? data : JSON.stringify(data) })
    });
    if (res.ok) {
      const json = await res.json();
      return json.url || '';
    }
  } catch (err) {
    console.warn('[r2Storage] uploadLogsToR2 error:', err);
  }
  return '';
}

export async function fetchLogsFromR2(key: string): Promise<any> {
  try {
    const res = await fetch(`/api/r2/logs?key=${encodeURIComponent(key)}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchLogsFromR2 error:', err);
  }
  return null;
}

export async function fetchDebugPayloadFromR2(jobIdOrUrl: string, userId?: string): Promise<any> {
  try {
    const query = new URLSearchParams({ jobId: jobIdOrUrl });
    if (userId) query.set('userId', userId);
    const res = await fetch(`/api/debug/load?${query.toString()}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchDebugPayloadFromR2 error:', err);
  }
  return null;
}

export async function uploadJobResultToR2(jobId: string, result: any): Promise<boolean> {
  try {
    const res = await fetch('/api/r2/upload-job-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, result })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] uploadJobResultToR2 error:', err);
    return false;
  }
}

export async function fetchJobResultFromR2(jobId: string): Promise<any> {
  try {
    const res = await fetch(`/api/r2/job-result?jobId=${encodeURIComponent(jobId)}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchJobResultFromR2 error:', err);
  }
  return null;
}

export async function deleteR2ObjectByKey(key: string): Promise<boolean> {
  try {
    const res = await fetch('/api/r2/delete-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] deleteR2ObjectByKey error:', err);
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
