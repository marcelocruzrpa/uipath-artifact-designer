/**
 * Coverage for the shared JSON coercion helpers. They underpin every artifact
 * parser, so a single regression here ripples across all five artifact kinds.
 */
import { describe, expect, it } from 'vitest';
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringOr
} from '../../src/util/jsonShape';

describe('asRecord', () => {
  it('returns plain objects unchanged', () => {
    const o = { a: 1 };
    expect(asRecord(o)).toBe(o);
  });
  it('rejects arrays', () => {
    expect(asRecord([1, 2])).toEqual({});
  });
  it('rejects null, primitives, undefined', () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord('s')).toEqual({});
    expect(asRecord(42)).toEqual({});
    expect(asRecord(true)).toEqual({});
  });
});

describe('asString', () => {
  it('returns strings unchanged', () => {
    expect(asString('hi')).toBe('hi');
    expect(asString('')).toBe('');
  });
  it('returns undefined for non-strings', () => {
    expect(asString(undefined)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(42)).toBeUndefined();
    expect(asString({})).toBeUndefined();
    expect(asString([])).toBeUndefined();
  });
});

describe('asStringOr', () => {
  it('returns the string when present', () => {
    expect(asStringOr('x', 'fallback')).toBe('x');
    expect(asStringOr('', 'fallback')).toBe('');
  });
  it('returns the fallback for non-strings', () => {
    expect(asStringOr(undefined, 'fallback')).toBe('fallback');
    expect(asStringOr(null, 'fallback')).toBe('fallback');
    expect(asStringOr(42, 'fallback')).toBe('fallback');
  });
});

describe('asArray', () => {
  it('returns arrays unchanged', () => {
    const a = [1, 2, 3];
    expect(asArray(a)).toBe(a);
  });
  it('returns [] for non-arrays', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray({})).toEqual([]);
    expect(asArray('not array')).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});

describe('asNumber', () => {
  it('returns finite numbers', () => {
    expect(asNumber(0)).toBe(0);
    expect(asNumber(42)).toBe(42);
    expect(asNumber(-1.5)).toBe(-1.5);
  });
  it('rejects NaN and Infinity', () => {
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber(Infinity)).toBeUndefined();
    expect(asNumber(-Infinity)).toBeUndefined();
  });
  it('rejects non-numbers', () => {
    expect(asNumber('42')).toBeUndefined();
    expect(asNumber(true)).toBeUndefined();
    expect(asNumber(undefined)).toBeUndefined();
    expect(asNumber(null)).toBeUndefined();
  });
});

describe('asBoolean', () => {
  it('returns booleans unchanged', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
  });
  it('rejects truthy/falsy non-booleans', () => {
    expect(asBoolean(1)).toBeUndefined();
    expect(asBoolean(0)).toBeUndefined();
    expect(asBoolean('true')).toBeUndefined();
    expect(asBoolean(undefined)).toBeUndefined();
    expect(asBoolean(null)).toBeUndefined();
  });
});
