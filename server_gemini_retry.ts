export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseMs?: number; label?: string }
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseMs = opts?.baseMs ?? 500;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.log('[FreeTier] gemini retry', attempt, opts?.label || '');
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retriable = /429|5\d\d|resource\.exhausted|unavailable|timeout|ECONNRESET/i.test(msg);
      if (!retriable || attempt === retries) throw e;
      const delay = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
