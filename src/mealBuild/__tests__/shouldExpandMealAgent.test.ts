import { describe, it, expect } from 'vitest';
import { shouldExpandMealAgent } from '../shouldExpandMealAgent';

describe('shouldExpandMealAgent', () => {
  it('stays on one dispatch for packaged / simple meals', () => {
    expect(shouldExpandMealAgent({ dishCount: 2, imageCount: 1 })).toBe(false);
    expect(shouldExpandMealAgent({ dishCount: 1, imageCount: 2 })).toBe(false);
    expect(shouldExpandMealAgent({ dishCount: 3, imageCount: 1 })).toBe(false);
  });

  it('expands for crowded plates, multi-photo, receipt, or barcode', () => {
    expect(shouldExpandMealAgent({ dishCount: 4, imageCount: 1 })).toBe(true);
    expect(shouldExpandMealAgent({ dishCount: 2, imageCount: 3 })).toBe(true);
    expect(shouldExpandMealAgent({ dishCount: 1, imageCount: 1, hasReceipt: true })).toBe(true);
    expect(shouldExpandMealAgent({ dishCount: 1, imageCount: 1, hasBarcode: true })).toBe(true);
  });

  it('does not expand a simple two-dish one-photo meal', () => {
    expect(shouldExpandMealAgent({ dishCount: 2, imageCount: 1 })).toBe(false);
  });
});
