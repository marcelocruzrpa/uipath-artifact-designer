/**
 * Shared object / type-guard helpers. No vscode, Node or DOM dependency, so
 * this is safe to import from the pure model layer, the descriptors and the
 * webview alike.
 */

/** True when `value` is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
