import { describe, it, expect } from 'vitest';
import {
  isGeminiQuotaError,
  withGeminiRetry,
  noteGeminiQuota,
  remainingQuotaCooldownMs,
  nextGeminiFallbackEngine,
  GEMINI_FALLBACK_ENGINE,
} from './server_gemini_retry';

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

describe('nextGeminiFallbackEngine (stall/503 fails the model, not the job)', () => {
  const stall = new Error(
    'Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt. Switch to gemini-3.1-flash-lite.'
  );

  it('falls back 3.5 → 3.1 on a 90s scout stall', () => {
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', stall, false)).toBe(GEMINI_FALLBACK_ENGINE);
  });

  it('falls back on AbortError whose cause is the stall', () => {
    const abort: any = new Error('This operation was aborted');
    abort.name = 'AbortError';
    abort.cause = stall;
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', abort, false)).toBe(GEMINI_FALLBACK_ENGINE);
  });

  it('falls back on 503 high demand', () => {
    expect(
      nextGeminiFallbackEngine('gemini-3.5-flash-lite', new Error('503 UNAVAILABLE high demand'), false)
    ).toBe(GEMINI_FALLBACK_ENGINE);
  });

  it('falls back on quota cooldown so the job does not wait for the user to switch models', () => {
    expect(
      nextGeminiFallbackEngine('gemini-3.5-flash-lite', new Error('quota cooldown 40s'), false)
    ).toBe(GEMINI_FALLBACK_ENGINE);
  });

  it('does not hop a second time or when already on 3.1', () => {
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', stall, true)).toBeNull();
    expect(nextGeminiFallbackEngine(GEMINI_FALLBACK_ENGINE, stall, false)).toBeNull();
  });

  it('does not treat a generic abort or a parse bug as a model outage', () => {
    const abort: any = new Error('This operation was aborted');
    abort.name = 'AbortError';
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', abort, false)).toBeNull();
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', new Error('Unexpected token in JSON'), false)).toBeNull();
  });
});
