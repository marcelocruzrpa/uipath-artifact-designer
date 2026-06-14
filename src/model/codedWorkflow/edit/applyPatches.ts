import type { TextPatch } from './editTypes';

/**
 * Apply non-overlapping patches right-to-left so earlier offsets stay valid.
 */
export function applyPatches(source: string, patches: TextPatch[]): string {
  return [...patches]
    .sort((a, b) => b.start - a.start)
    .reduce((s, p) => s.slice(0, p.start) + p.newText + s.slice(p.end), source);
}
