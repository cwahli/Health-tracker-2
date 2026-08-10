/**
 * Sanitizes an object for Firestore by removing undefined fields and nested undefined values.
 * This is the ONLY function used for all Firestore writes to ensure consistency.
 */
export function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }

  // Handle Dates, RegExps, etc. (Firestore supports Dates but we can just pass them)
  if (Object.prototype.toString.call(obj) !== '[object Object]') {
    return obj;
  }

  const cleaned: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      const sanitized = sanitizeForFirestore(v);
      if (sanitized !== undefined) {
        cleaned[k] = sanitized;
      }
    }
  }
  return cleaned;
}

export const checkQuotaFlag = (): boolean => {
  const flagSet = localStorage.getItem('firestore_quota_exceeded') === 'true';
  if (!flagSet) return false;

  const setTime = parseInt(localStorage.getItem('firestore_quota_exceeded_time') || '0', 10);
  const nowTime = new Date().getTime();
  const ONE_HOUR = 3600000;

  if (nowTime - setTime > ONE_HOUR) {
    localStorage.removeItem('firestore_quota_exceeded');
    localStorage.removeItem('firestore_quota_exceeded_time');
    console.log('[Quota Recovery] Quota exceeded flag expired; retrying connection.');
    return false;
  }
  return true;
};

export const handleRetryQuota = () => {
  localStorage.removeItem('firestore_quota_exceeded');
  localStorage.removeItem('firestore_quota_exceeded_time');
  window.location.reload();
};
