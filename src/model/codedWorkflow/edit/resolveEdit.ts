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
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      return { ok: true, patches: [insertionPatch(target, intent.index, intent.source, eol, source)] };
    }
    case 'deleteStatement': {
      const node = findNodeById(model, intent.id);
      if (node === null || node.offsets === undefined) {
        return { ok: false, error: 'statement not found or not deletable' };
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
      // Swap the two statements' source text (their offset slices), preserving
      // everything between them. Two non-overlapping replacements.
      const aText = source.slice(a.offsets.start, a.offsets.end);
      const bText = source.slice(b.offsets.start, b.offsets.end);
      return {
        ok: true,
        patches: [
          { start: a.offsets.start, end: a.offsets.end, newText: bText },
          { start: b.offsets.start, end: b.offsets.end, newText: aText }
        ]
      };
    }
    default: return { ok: false, error: `unsupported edit: ${(intent as { kind: string }).kind}` };
  }
}
