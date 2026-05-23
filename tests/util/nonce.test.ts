/**
 * Tests for the CSP nonce generator (`getNonce`).
 *
 * The CSP `script-src`/`style-src` directives only trust this exact nonce, so
 * it must be unpredictable (M2 — CSPRNG, not `Math.random()`) and unique per
 * call.
 */
import { describe, expect, it } from 'vitest';
import { getNonce } from '../../src/util/nonce';

describe('getNonce', () => {
  it('returns a non-empty string', () => {
    const nonce = getNonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
  });

  it('returns a base64url string — only URL-safe characters', () => {
    // base64url uses A-Z a-z 0-9 - _ ; no '+', '/' or '=' padding.
    expect(getNonce()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a fresh value on every call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(getNonce());
    }
    expect(seen.size).toBe(1000);
  });

  it('encodes 16 random bytes', () => {
    // Asserting the byte count instead of the encoded character length: the
    // CSP security property is "16 bytes of CSPRNG entropy," not "22 base64url
    // characters." If the encoding ever changes (padding, alphabet), this
    // assertion still catches an entropy regression. base64url decodes
    // identically to base64 in `Buffer.from`.
    const decoded = Buffer.from(getNonce(), 'base64url');
    expect(decoded.length).toBe(16);
  });
});
