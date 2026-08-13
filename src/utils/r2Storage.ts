
// Storage preserves photo to /photos/ and raw log to /debug/
// endpoint d17eecca64f82625d29dc38b14f46c14.r2.cloudflarestorage.com

export async function uploadPhotoToR2(jobId: string, imageBlobOrDataUrl: string): Promise<string> {
  if (typeof window === 'undefined') {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
      const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
      const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

      const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/photos/${jobId}.jpg`;
      if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
        console.error('[R2Storage] Missing R2 credentials — skipping photo upload, returning empty to signal failure instead of a URL that was never written.');
        return '';
      }

      const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const client = new S3Client({
        region: 'auto',
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
          secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        },
      });

      let body;
      let contentType = 'image/jpeg';

      if (imageBlobOrDataUrl.startsWith('data:')) {
        const match = imageBlobOrDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          contentType = match[1];
          body = Buffer.from(match[2], 'base64');
        } else {
          body = Buffer.from(imageBlobOrDataUrl);
        }
      } else {
        body = Buffer.from(imageBlobOrDataUrl);
      }

      const command = new PutObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: `photos/${jobId}.jpg`,
        Body: body,
        ContentType: contentType,
      });
      await client.send(command);
      return publicUrl;
    } catch (err) {
      console.error('[R2Storage] Server-side uploadPhotoToR2 failed:', err);
      return '';
    }
  }

  try {
    let payload = imageBlobOrDataUrl;
    if (payload.startsWith('blob:')) {
      const res = await fetch(payload);
      const blob = await res.blob();
      
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      payload = dataUrl;
    }

    const res = await fetch('/api/r2/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload }),
    });
    if (!res.ok) throw new Error('Failed to upload photo');
    const data = await res.json();
    return data.url;
  } catch (err) {
    console.error('[R2Storage] Failed uploading photo to R2:', err);
    return '';
  }
}

// Additive batch helper. Uploads multiple images with indexed keys
// (photos/{jobId}_0.jpg, photos/{jobId}_1.jpg, ...) so old single-image jobs
// using the un-indexed photos/{jobId}.jpg key from uploadPhotoToR2 keep working.
export async function uploadPhotosToR2(jobId: string, images: string[]): Promise<string[]> {
  if (!images || images.length === 0) return [];
  if (images.length === 1) {
    const url = await uploadPhotoToR2(jobId, images[0]);
    return url ? [url] : [];
  }
  const results = await Promise.all(
    images.map((img, i) => uploadPhotoToR2(`${jobId}_${i}`, img))
  );
  return results.filter(Boolean);
}

export async function uploadDebugPayloadToR2(jobId: string, debugJson: object): Promise<string> {
  if (typeof window === 'undefined') {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
      const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
      const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

      const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/debug/${jobId}.json`;
      if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
        console.error('[R2Storage] Missing R2 credentials — skipping debug payload upload, returning empty to signal failure instead of a URL that was never written.');
        return '';
      }

      const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const client = new S3Client({
        region: 'auto',
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
          secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        },
      });

      const body = Buffer.from(JSON.stringify(debugJson, null, 2));

      const command = new PutObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: `debug/${jobId}.json`,
        Body: body,
        ContentType: 'application/json',
      });
      await client.send(command);
      return publicUrl;
    } catch (err) {
      console.error('[R2Storage] Server-side uploadDebugPayloadToR2 failed:', err);
      return '';
    }
  }

  try {
    const res = await fetch('/api/r2/upload-debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload: debugJson }),
    });
    if (!res.ok) throw new Error('Failed to upload debug payload');
    const data = await res.json();
    return data.url;
  } catch (err) {
    console.error('[R2Storage] Failed uploading debug payload to R2:', err);
    return '';
  }
}

export async function fetchDebugPayloadFromR2(jobId: string): Promise<any> {
  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const CLOUDFLARE_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
    const CLOUDFLARE_R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
    const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

    if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      return null;
    }

    const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });

    const cleanKey = jobId.includes('debug/') ? jobId : `debug/${jobId}.json`;
    const command = new GetObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: cleanKey,
    });

    const response = await client.send(command);
    if (response.Body) {
      const bodyString = await response.Body.transformToString();
      return JSON.parse(bodyString);
    }
  } catch (err: any) {
    console.debug(`[R2Storage] Skipping or failed to fetch debug payload for ${jobId}:`, err?.message || err);
  }
  return null;
}

export async function uploadJobResultToR2(jobId: string, resultJson: object): Promise<string> {
  if (typeof window === 'undefined') {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
      const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
      const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

      const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/jobs/${jobId}_result.json`;
      if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
        console.error('[R2Storage] Missing R2 credentials — skipping job result upload, returning empty to signal failure instead of a URL that was never written. Caller must fall back to storing the full result inline.');
        return '';
      }

      const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const client = new S3Client({
        region: 'auto',
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
          secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        },
      });

      const body = Buffer.from(JSON.stringify(resultJson, null, 2));

      const command = new PutObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: `jobs/${jobId}_result.json`,
        Body: body,
        ContentType: 'application/json',
      });
      await client.send(command);
      return publicUrl;
    } catch (err) {
      console.error('[R2Storage] Server-side uploadJobResultToR2 failed:', err);
      return '';
    }
  }

  try {
    const res = await fetch('/api/r2/upload-job-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload: resultJson }),
    });
    if (!res.ok) throw new Error('Failed to upload job result payload');
    const data = await res.json();
    return data.url;
  } catch (err) {
    console.error('[R2Storage] Failed uploading job result payload to R2:', err);
    return '';
  }
}

export async function fetchJobResultFromR2(jobId: string): Promise<any> {
  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
    const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
    const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

    if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      // Fallback to public URL if no credentials
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const url = `${CLOUDFLARE_R2_PUBLIC_URL}/jobs/${jobId}_result.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        return await res.json();
      }
      return null;
    }

    const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });

    const command = new GetObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `jobs/${jobId}_result.json`,
    });

    const response = await client.send(command);
    if (response.Body) {
      const bodyString = await response.Body.transformToString();
      return JSON.parse(bodyString);
    }
  } catch (err: any) {
    console.debug(`[R2Storage] Skipping or failed to fetch job result for ${jobId}:`, err?.message || err);
  }
  return null;
}

export async function uploadLogsToR2(jobId: string, logsText: string): Promise<string> {
  if (typeof window === 'undefined') {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const CLOUDFLARE_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
      const CLOUDFLARE_R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
      const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

      const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/logs/${jobId}.log`;
      if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
        console.error('[R2Storage] Missing R2 credentials — skipping logs upload.');
        return '';
      }

      const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const client = new S3Client({
        region: 'auto',
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
          secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        },
      });

      const body = Buffer.from(logsText, 'utf-8');

      const command = new PutObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: `logs/${jobId}.log`,
        Body: body,
        ContentType: 'text/plain',
      });
      await client.send(command);
      return publicUrl;
    } catch (err) {
      console.error('[R2Storage] Server-side uploadLogsToR2 failed:', err);
      return '';
    }
  }

  try {
    const res = await fetch('/api/r2/upload-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, logsText }),
    });
    if (!res.ok) throw new Error('Failed to upload logs');
    const data = await res.json();
    return data.url;
  } catch (err) {
    console.error('[R2Storage] Failed uploading logs to R2:', err);
    return '';
  }
}

export async function fetchLogsFromR2(jobId: string): Promise<string | null> {
  try {
    const CLOUDFLARE_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
    const CLOUDFLARE_R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
    const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

    if (!CLOUDFLARE_R2_ACCESS_KEY_ID || !CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      const CLOUDFLARE_R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
      const url = `${CLOUDFLARE_R2_PUBLIC_URL}/logs/${jobId}.log`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        return await res.text();
      }
      return null;
    }

    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });

    const command = new GetObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `logs/${jobId}.log`,
    });

    const response = await client.send(command);
    if (response.Body) {
      return await response.Body.transformToString();
    }
  } catch (err: any) {
    console.debug(`[R2Storage] Skipping or failed to fetch logs for ${jobId}:`, err?.message || err);
  }
  return null;
}

/* stripHeavyImages coldDebugR2Key COLD_DEBUG_LOG opts?: { userId? */
