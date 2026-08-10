/**
 * Utility to compress images on the client side using HTML5 Canvas
 * to prevent exceeding Firestore 1MB document limit.
 */

export interface CompressionProgress {
  currentIndex: number;
  totalCount: number;
  percentage: number;
  stage: 'loading' | 'compressing' | 'done';
}

function fileOrBlobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Allow cross-origin image loading if URL is remote
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image element: ' + (err instanceof Error ? err.message : 'Unknown error')));
    img.src = src;
  });
}

export async function compressImage(
  base64OrFile: string | File | Blob,
  maxWidth = 400,
  maxHeight = 400,
  quality = 0.5
): Promise<string> {
  let imageSrc = '';
  let objectUrlToRevoke: string | null = null;

  if (typeof base64OrFile === 'string') {
    imageSrc = base64OrFile;
  } else if (base64OrFile instanceof File || base64OrFile instanceof Blob) {
    // Try ObjectURL first, fallback to FileReader readAsDataURL
    try {
      objectUrlToRevoke = URL.createObjectURL(base64OrFile);
      imageSrc = objectUrlToRevoke;
    } catch {
      try {
        imageSrc = await fileOrBlobToDataURL(base64OrFile);
      } catch (frErr) {
        throw new Error('FileReader failed to read file: ' + (frErr instanceof Error ? frErr.message : 'Unknown error'));
      }
    }
  } else if (base64OrFile && typeof (base64OrFile as any).url === 'string') {
    imageSrc = (base64OrFile as any).url;
  } else {
    throw new Error('Invalid image input format');
  }

  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(imageSrc);
    } catch (loadErr) {
      // If ObjectURL failed, try FileReader data URL as secondary fallback
      if (objectUrlToRevoke && (base64OrFile instanceof File || base64OrFile instanceof Blob)) {
        try {
          const dataUrl = await fileOrBlobToDataURL(base64OrFile);
          img = await loadImage(dataUrl);
        } catch (innerErr) {
          throw loadErr;
        }
      } else {
        throw loadErr;
      }
    }

    let width = img.width || maxWidth;
    let height = img.height || maxHeight;

    // Calculate aspect ratio resizing
    if (width > height) {
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
    } else {
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context from canvas');
    }

    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    if (objectUrlToRevoke) {
      try {
        URL.revokeObjectURL(objectUrlToRevoke);
      } catch {
        // ignore revocation errors
      }
    }
  }
}

/**
 * Compress multiple images sequentially with a progress callback
 */
export async function compressMultipleImages(
  files: any,
  onProgress?: (progress: CompressionProgress) => void,
  maxWidth = 400,
  maxHeight = 400,
  quality = 0.5
): Promise<string[]> {
  const list = Array.from(files || []) as (File | Blob | string)[];
  const results: string[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    
    // Notify starting compression
    if (onProgress) {
      onProgress({
        currentIndex: i + 1,
        totalCount: list.length,
        percentage: Math.round((i / list.length) * 100),
        stage: 'compressing'
      });
    }

    try {
      const compressed = await compressImage(item, maxWidth, maxHeight, quality);
      results.push(compressed);
    } catch (err) {
      console.warn(`Warning compressing image at index ${i}:`, err);
      // Fallback: If it's a string, keep it; if it's a file/blob, attempt raw read
      if (typeof item === 'string') {
        results.push(item);
      } else if (item instanceof File || item instanceof Blob) {
        try {
          const rawBase64 = await fileOrBlobToDataURL(item);
          results.push(rawBase64);
        } catch (readErr) {
          console.warn(`Could not read raw file fallback at index ${i}:`, readErr);
        }
      }
    }
  }

  if (onProgress) {
    onProgress({
      currentIndex: list.length,
      totalCount: list.length,
      percentage: 100,
      stage: 'done'
    });
  }

  return results;
}

