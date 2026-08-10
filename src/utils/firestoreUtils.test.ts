import { describe, it, expect } from 'vitest';
import { sanitizeForFirestore } from './firestoreUtils';

describe('sanitizeForFirestore', () => {
  it('strips top-level undefined fields', () => {
    const input = { a: 1, b: undefined, c: 'x' };
    expect(sanitizeForFirestore(input)).toEqual({ a: 1, c: 'x' });
  });

  it('strips undefined fields from nested objects', () => {
    const input = { a: { b: 1, c: undefined }, d: 2 };
    expect(sanitizeForFirestore(input)).toEqual({ a: { b: 1 }, d: 2 });
  });

  it('strips undefined fields from objects inside arrays', () => {
    const input = { items: [{ x: 1, y: undefined }, { x: 2, y: 3 }] };
    expect(sanitizeForFirestore(input)).toEqual({ items: [{ x: 1 }, { x: 2, y: 3 }] });
  });

  it('preserves null (does not treat null as undefined)', () => {
    const input = { a: null, b: 1 };
    expect(sanitizeForFirestore(input)).toEqual({ a: null, b: 1 });
  });

  it('returns null for a top-level null or undefined input', () => {
    expect(sanitizeForFirestore(null)).toBeNull();
    expect(sanitizeForFirestore(undefined)).toBeNull();
  });

  it('passes primitives through unchanged', () => {
    expect(sanitizeForFirestore(5)).toBe(5);
    expect(sanitizeForFirestore('hello')).toBe('hello');
  });
});
