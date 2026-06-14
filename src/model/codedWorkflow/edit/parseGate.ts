import type { CSharpParserHandle } from '../parser';

function hasError(parser: CSharpParserHandle, source: string): boolean {
  const tree = parser.parse(source);
  try { return tree.rootNode.hasError; } finally { tree.delete(); }
}

/** True when `after` parses with an error that `before` did not have. */
export function introducesNewError(
  parser: CSharpParserHandle, before: string, after: string
): boolean {
  return hasError(parser, after) && !hasError(parser, before);
}
