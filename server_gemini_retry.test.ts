import { describe, it, expect } from 'vitest';
import { isGeminiQuotaError, withGeminiRetry, noteGeminiQuota, remainingQuotaCooldownMs } from './server_gemini_retry';

describe('gemini retry / quota', () => {
  it('treats RESOURCE_EXHAUSTED as quota', () => {
    expect(isGeminiQuotaError({ message: 'RESOURCE_EXHAUSTED 429' })).toBe(true);
    expect(isGeminiQuotaError({ message: '503 high demand' })).toBe(false);
  });

  it('does not retry a 429', async () => {
    let n = 0;
    await expect(
      withGeminiRetry(
        async () => {
          n += 1;
          throw new Error('429 RESOURCE_EXHAUSTED retry in 40s');
        },
        { retries: 3 }
      )
    ).rejects.toThrow(/429/);
    expect(n).toBe(1);
  });

  it('cools down only the model that 429d', () => {
    noteGeminiQuota('gemini-3.5-flash-lite', new Error('retry in 30s'));
    expect(remainingQuotaCooldownMs('gemini-3.5-flash-lite')).toBeGreaterThan(1000);
    expect(remainingQuotaCooldownMs('gemini-3.1-flash-lite')).toBe(0);
  });
});
