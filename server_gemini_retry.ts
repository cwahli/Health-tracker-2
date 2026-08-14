export function isGeminiQuotaError(e: any): boolean {
  return /429|RESOURCE_EXHAUSTED|quota exceeded|generate_content_free_tier/i.test(String(e?.message || e || ''));
}

export function isGeminiUnavailableError(e: any): boolean {
  return /503|UNAVAILABLE|high demand/i.test(String(e?.message || e || ''));
}

export function parseRetryAfterMs(e: any): number | null {
  const s = String(e?.message || e || '');
  const m = s.match(/retry in ([\d.]+)\s*s/i) || s.match(/retryDelay"\s*:\s*"(\d+)s"/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? Math.ceil(n * 1000) : null;
}

/** Per-model cooldown so a 429 on 3.5-lite does not block 3.1-lite. */
const quotaBlockUntil = new Map<string, number>();

export function noteGeminiQuota(modelId: string, err?: any) {
  const wait = parseRetryAfterMs(err) ?? 60_000;
  const until = Date.now() + wait;
  const prev = quotaBlockUntil.get(modelId) || 0;
  if (until > prev) quotaBlockUntil.set(modelId, until);
}

export function remainingQuotaCooldownMs(modelId: string): number {
  return Math.max(0, (quotaBlockUntil.get(modelId) || 0) - Date.now());
}

export function assertModelNotInQuotaCooldown(modelId: string) {
  const left = remainingQuotaCooldownMs(modelId);
  if (left <= 0) return;
  const sec = Math.ceil(left / 1000);
  throw new Error(
    `Model ${modelId} is in quota cooldown for ${sec}s (free-tier 15 req/min). Switch to gemini-3.1-flash-lite in the top-left dropdown — it has a separate quota.`
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseMs?: number; label?: string }
): Promise<T> {
  // 429 must never be retried — each retry burns the same 15/min bucket.
  // 503: at most one extra try after a short wait.
  const retries = opts?.retries ?? 1;
  const baseMs = opts?.baseMs ?? 1500;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.log('[FreeTier] gemini retry', attempt, opts?.label || '');
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (isGeminiQuotaError(e)) throw e;
      const msg = String(e?.message || e);
      const retriable = isGeminiUnavailableError(e) || /502|504|timeout|ECONNRESET/i.test(msg);
      if (!retriable || attempt === retries) throw e;
      const delay = isGeminiUnavailableError(e)
        ? 2000
        : baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
