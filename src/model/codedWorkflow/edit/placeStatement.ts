// src/model/codedWorkflow/edit/placeStatement.ts
// PURITY: pure span arithmetic over strings + model statements. No parser.
import type { CwStatement } from '../cwTypes';
import type { TextPatch } from './editTypes';
import type { SlotTarget } from './findNode';

/**
 * Patch that inserts `statementSource` into a slot at `index` (insert-before;
 * index === children.length ⇒ append). Indentation = the slot's inferred
 * `indentText`; `eol` is the document's line ending. `source` is the full
 * document — only the EMPTY-slot path reads it, to reuse the existing close-brace
 * line instead of synthesizing one (which left a trailing-whitespace blank line).
 */
export function insertionPatch(
  target: SlotTarget,
  index: number,
  statementSource: string,
  eol: string,
  source = ''
): TextPatch {
  const indent = target.indentText ?? '    ';
  const kids = target.children;
  if (kids.length === 0) {
    // Empty slot: drop the statement on its own indented line. A pretty-printed
    // empty block already carries `\n<closeIndent>` before its `}`, so inserting
    // the statement line right after `{` lets that existing tail close the block
    // — no synthesized trailing line, no trailing whitespace. A degenerate `{}`
    // (empty interior) instead needs BOTH the statement line and a fresh close
    // line at the block's own indent (one step shallower than the statement).
    const at = target.bodySpan?.start ?? 0;
    const interior = source.slice(at, target.bodySpan?.end ?? at);
    if (/\n/.test(interior)) {
      return { start: at, end: at, newText: `${eol}${indent}${statementSource}` };
    }
    const closeIndent = closeIndentFrom(indent);
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}${eol}${closeIndent}` };
  }
  if (index >= kids.length) {
    // Append after the last child with an offset.
    const last = lastWithOffsets(kids);
    let at = last?.offsets?.end ?? target.bodySpan?.end ?? 0;
    // A statement's offsets END at its `;`/`}`, BEFORE a same-line trailing line
    // comment (`Log("a"); // note`). Inserting there would slide the comment onto
    // the NEW statement. If one is present, append after the physical line so the
    // comment stays with its own statement.
    at = afterTrailingLineComment(source, at);
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}` };
  }
  // Insert before child[index].
  const ref = firstWithOffsetsFrom(kids, index);
  const at = ref?.offsets?.start ?? target.bodySpan?.start ?? 0;
  return { start: at, end: at, newText: `${statementSource}${eol}${indent}` };
}

/**
 * Best-effort close-brace indent for a degenerate `{}` slot: the statement
 * indent minus one step. We only reach this when the block had NO interior
 * whitespace to copy, so we strip a trailing tab (tab-indented) or the trailing
 * spaces of a 2-space step. Cosmetic for the rare single-line-empty-block case;
 * the multi-line path (which reuses the real close line) never calls this.
 */
function closeIndentFrom(indent: string): string {
  if (indent.endsWith('\t')) return indent.slice(0, -1);
  return indent.replace(/ {1,2}$/, '');
}

/**
 * If a same-line trailing LINE comment (`// …`) follows position `at` (only
 * whitespace in between), return the index at the END of that physical line
 * (before the EOL) so an append lands AFTER the comment. Otherwise return `at`
 * unchanged. Only `//` is handled — a block comment may span lines or carry
 * trailing code, so it is left to the move/delete guards. `source === ''`
 * (no document supplied) is a no-op.
 */
function afterTrailingLineComment(source: string, at: number): number {
  if (source === '' || at >= source.length) return at;
  let i = at;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i += 1;
  if (source[i] !== '/' || source[i + 1] !== '/') return at;
  let nl = source.indexOf('\n', i);
  if (nl === -1) return source.length;
  if (nl > 0 && source[nl - 1] === '\r') nl -= 1;
  return nl;
}

function lastWithOffsets(kids: CwStatement[]): CwStatement | undefined {
  for (let i = kids.length - 1; i >= 0; i -= 1) if (kids[i].offsets) return kids[i];
  return undefined;
}
function firstWithOffsetsFrom(kids: CwStatement[], from: number): CwStatement | undefined {
  for (let i = from; i < kids.length; i += 1) if (kids[i].offsets) return kids[i];
  return undefined;
}

/**
 * Full-line deletion range for a statement at `offsets`: extend left to the
 * line start (eating leading indent) and right to and including the trailing
 * newline, so no blank line is left behind.
 */
export function deletionPatch(source: string, offsets: { start: number; end: number }): TextPatch {
  let start = source.lastIndexOf('\n', offsets.start - 1) + 1; // line start
  let end = offsets.end;
  // Eat trailing spaces then a single newline (\r\n or \n).
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end += 1;
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;
  // If we ate up to a newline but the line-start has prior non-deleted content
  // on the SAME physical line (inline statement), fall back to the exact range.
  if (source.slice(start, offsets.start).trim() !== '') {
    start = offsets.start;
    end = offsets.end;
  }
  return { start, end, newText: '' };
}
