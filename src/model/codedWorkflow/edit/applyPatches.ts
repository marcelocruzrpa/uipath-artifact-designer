import type { TextPatch } from './editTypes';

/**
 * Apply non-overlapping patches right-to-left so earlier offsets stay valid.
 *
 * Throws if any two patches overlap (after sorting, each patch's `end` must not
 * exceed the next patch's `start`). The resolvers only ever emit disjoint
 * patches, so an overlap signals a logic bug upstream — failing loudly here is
 * far safer than silently double-editing or dropping a slice of source.
 */
export function applyPatches(source: string, patches: TextPatch[]): string {
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `applyPatches: overlapping patches [${sorted[i - 1].start},${sorted[i - 1].end}) ` +
          `and [${sorted[i].start},${sorted[i].end})`
      );
    }
  }
  return sorted
    .reverse()
    .reduce((s, p) => s.slice(0, p.start) + p.newText + s.slice(p.end), source);
}
