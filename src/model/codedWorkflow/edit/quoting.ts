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
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
