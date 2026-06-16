import type { CodedWorkflowModel } from '../cwTypes';
import type { EditIntent, EditResult } from './editTypes';
import { editValue } from './editValue';
import { editArg } from './editArg';
import { findNodeById, findSlot, findSiblings } from './findNode';
import { insertionPatch, deletionPatch } from './placeStatement';

export function resolveEdit(
  source: string, model: CodedWorkflowModel, intent: EditIntent
): EditResult {
  switch (intent.kind) {
    case 'editValue': return editValue(source, model, intent);
    case 'editArg': return editArg(source, model, intent);
    case 'addStatement': {
      const target = findSlot(model, intent.slot);
      if (target === null) return { ok: false, error: 'insertion slot not found' };
      // Block-less control-flow body (`if (ok) Foo();`): splicing a statement here
      // would silently make it run UNCONDITIONALLY — the new line lands after the
      // single body statement but outside any `{ }`, so it escapes the control-flow
      // scope. Both before/after parse clean, so the syntax gate cannot catch it.
      // Reject and tell the user to brace the body first.
      if (target.braced === false) {
        return {
          ok: false,
          error: 'cannot insert into an unbraced control-flow body — convert it to a { } block first'
        };
      }
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      return { ok: true, patches: [insertionPatch(target, intent.index, intent.source, eol, source)] };
    }
    case 'deleteStatement': {
      const node = findNodeById(model, intent.id);
      if (node === null || node.offsets === undefined) {
        return { ok: false, error: 'statement not found or not deletable' };
      }
      // A trailing same-line `//…` comment is outside the statement's offsets;
      // a full-line delete would strand it on a now-empty line (or, if other code
      // shares the line, leave it dangling). Reject rather than guess the user's
      // intent for the orphaned comment.
      if (hasTrailingLineComment(source, node.offsets)) {
        return { ok: false, error: 'cannot delete a statement that has a trailing // comment' };
      }
      return { ok: true, patches: [deletionPatch(source, node.offsets)] };
    }
    case 'moveStatement': {
      const found = findSiblings(model, intent.id);
      if (found === null) return { ok: false, error: 'statement not found' };
      const j = found.index + intent.direction;
      if (j < 0 || j >= found.siblings.length) {
        return { ok: false, error: 'cannot move past the slot boundary' };
      }
      const a = found.siblings[found.index];
      const b = found.siblings[j];
      if (a.offsets === undefined || b.offsets === undefined) {
        return { ok: false, error: 'a statement in the swap has no source offsets' };
      }
      // A trailing same-line `//…` comment is part of the statement's line but
      // sits OUTSIDE its `offsets`. Swapping the bare offset slices would strand
      // each comment on the wrong statement (move b's code under a's comment).
      // Reject when either statement carries such a comment rather than silently
      // misattributing it. (Delete has the same hazard; see deletionPatch.)
      if (hasTrailingLineComment(source, a.offsets) || hasTrailingLineComment(source, b.offsets)) {
        return { ok: false, error: 'cannot move a statement that has a trailing // comment' };
      }
      // Swap the two statements' source text (their offset slices), preserving
      // everything between them. Two non-overlapping replacements, emitted
      // descending by start so applying them left-as-written is already correct
      // (applyPatches also re-sorts, but correctness must not depend on that).
      const aText = source.slice(a.offsets.start, a.offsets.end);
      const bText = source.slice(b.offsets.start, b.offsets.end);
      const lo = { start: a.offsets.start, end: a.offsets.end, newText: bText };
      const hi = { start: b.offsets.start, end: b.offsets.end, newText: aText };
      return {
        ok: true,
        patches: lo.start >= hi.start ? [lo, hi] : [hi, lo]
      };
    }
    default: return { ok: false, error: `unsupported edit: ${(intent as { kind: string }).kind}` };
  }
}

/**
 * True when an immediately-trailing same-line `//…` comment follows the
 * statement at `offsets` (`Foo(); // note`). Scans rightward from the
 * statement end over spaces/tabs only; a `//` reached before any newline is a
 * trailing line comment that belongs to this statement's line but sits outside
 * its offsets, so delete/move must not silently strand or misattribute it.
 */
function hasTrailingLineComment(source: string, offsets: { start: number; end: number }): boolean {
  let i = offsets.end;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i += 1;
  return source[i] === '/' && source[i + 1] === '/';
}
