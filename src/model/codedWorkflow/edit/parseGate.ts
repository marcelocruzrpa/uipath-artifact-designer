import type { CSharpParserHandle } from '../parser';
import type { Node } from 'web-tree-sitter';

/**
 * Count `ERROR` + `MISSING` nodes in a parsed tree. `node.hasError` is true for
 * any subtree that CONTAINS an error/missing node, so clean subtrees are pruned
 * — the walk is O(errors), not O(nodes), on healthy files. Anonymous children
 * are included because missing tokens (e.g. a dropped `;`) are anonymous.
 */
function countErrors(node: Node): number {
  if (!node.hasError && !node.isMissing) return 0;
  let count = node.type === 'ERROR' || node.isMissing ? 1 : 0;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null) count += countErrors(child);
  }
  return count;
}

/** Parse `source` and return its ERROR+MISSING node count. */
function errorCount(parser: CSharpParserHandle, source: string): number {
  const tree = parser.parse(source);
  try { return countErrors(tree.rootNode); } finally { tree.delete(); }
}

/**
 * True when `after` has STRICTLY MORE parse errors than `before`.
 *
 * Count-based, not boolean: an earlier version returned `after.hasError &&
 * !before.hasError`, which could never block a NEW error introduced into an
 * ALREADY-broken file (it allowed every edit once any error was present). By
 * comparing ERROR+MISSING counts it rejects an edit that ADDS an error even to
 * a broken file, while still permitting a benign edit that leaves the count
 * unchanged (or reduces it). Guards all edit paths (value / arg / statement).
 */
export function introducesNewError(
  parser: CSharpParserHandle, before: string, after: string
): boolean {
  return errorCount(parser, after) > errorCount(parser, before);
}
