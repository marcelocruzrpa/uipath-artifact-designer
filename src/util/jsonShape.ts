/**
 * Shape coercion helpers for parsing untrusted JSON. No `vscode` / Node /
 * DOM dependency — safe from both the host and the webview bundle.
 *
 * Coercion philosophy: never throw, always return a usable value. Callers
 * branch on `undefined` for missing scalars, or get an empty `{}` / `[]`
 * for missing containers so existing iteration patterns keep working.
 */
import { isRecord } from './objects';

/** Plain-object coercion. Arrays and null / primitives become `{}`. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** String coercion. Non-strings → `undefined`. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** String coercion with explicit fallback when missing or wrong type. */
export function asStringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Array coercion. Non-arrays become `[]`. Element type stays `unknown`. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Finite-number coercion. `NaN`, `Infinity`, and non-numbers → `undefined`. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Boolean coercion. Non-booleans → `undefined`. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
