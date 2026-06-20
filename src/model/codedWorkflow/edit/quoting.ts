// PURITY: no vscode/fs/path/node:* imports.

/**
 * Re-emit a C# string literal from edited CONTENT, preserving the original
 * delimiter style. Verbatim (@"...") keeps backslashes literal and doubles
 * embedded quotes; everything else emits a regular "..." with standard escapes.
 * (Raw string literals """...""" are normalized to a regular literal — rare in
 * coded workflows, and always value-equivalent.)
 */
export function requoteString(content: string, originalRaw: string): string {
  if (originalRaw.startsWith('@"')) {
    return `@"${content.replace(/"/g, '""')}"`;
  }
  let escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  // C# also treats NEL (U+0085), LS (U+2028) and PS (U+2029) as line
  // terminators, and a raw one inside a regular "..." literal is the compiler
  // error CS1010 "Newline in constant". web-tree-sitter tolerates them, so the
  // parse-gate cannot catch this — escape them to `\uXXXX` here. (The verbatim
  // branch above needs no change: a verbatim string may legally span lines.)
  for (const cp of [0x0085, 0x2028, 0x2029]) {
    escaped = escaped.split(String.fromCharCode(cp)).join('\\u' + cp.toString(16).padStart(4, '0'));
  }
  return `"${escaped}"`;
}
