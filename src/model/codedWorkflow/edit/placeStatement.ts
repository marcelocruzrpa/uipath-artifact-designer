// src/model/codedWorkflow/edit/placeStatement.ts
// PURITY: pure span arithmetic over strings + model statements. No parser.
import type { CwStatement } from '../cwTypes';
import type { TextPatch } from './editTypes';
import type { SlotTarget } from './findNode';

/**
 * Patch that inserts `statementSource` into a slot at `index` (insert-before;
 * index === children.length ⇒ append). Indentation = the slot's inferred
 * `indentText`; `eol` is the document's line ending.
 */
export function insertionPatch(
  target: SlotTarget,
  index: number,
  statementSource: string,
  eol: string
): TextPatch {
  const indent = target.indentText ?? '    ';
  const kids = target.children;
  if (kids.length === 0) {
    // Empty slot: drop the statement on its own line inside the body interior.
    const at = target.bodySpan?.start ?? 0;
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}${eol}${indent}` };
  }
  if (index >= kids.length) {
    // Append after the last child with an offset.
    const last = lastWithOffsets(kids);
    const at = last?.offsets?.end ?? target.bodySpan?.end ?? 0;
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}` };
  }
  // Insert before child[index].
  const ref = firstWithOffsetsFrom(kids, index);
  const at = ref?.offsets?.start ?? target.bodySpan?.start ?? 0;
  return { start: at, end: at, newText: `${statementSource}${eol}${indent}` };
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
