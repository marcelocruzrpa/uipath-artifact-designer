import { randomBytes } from 'node:crypto';

/**
 * Generates a cryptographically secure random nonce for the webview
 * Content-Security-Policy. The CSP `script-src`/`style-src` directives only
 * trust this exact nonce, so it must be unpredictable — `Math.random()` is not
 * a CSPRNG and must not be used here.
 */
export function getNonce(): string {
  return randomBytes(16).toString('base64url');
}
