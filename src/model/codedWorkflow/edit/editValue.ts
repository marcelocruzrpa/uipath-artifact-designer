import type { CodedWorkflowModel } from '../cwTypes';
import type { EditValueIntent, EditResult } from './editTypes';
import { findNodeById } from './findNode';
import { requoteString } from './quoting';

export function editValue(
  _source: string, model: CodedWorkflowModel, intent: EditValueIntent
): EditResult {
  const node = findNodeById(model, intent.id);
  if (node === null) return { ok: false, error: `node not found: ${intent.id}` };
  if (node.type !== 'activity') return { ok: false, error: 'only activity cards are value-editable in L0' };
  const arg = node.args[intent.argIndex];
  if (arg === undefined || arg.valueSpan === undefined || arg.editableKind === 'none')
    return { ok: false, error: `arg ${intent.argIndex} is not editable` };
  // String fields edit the message CONTENT, not the C# token: the host owns the
  // quotes so a low-code dev cannot turn a literal into a bare identifier by
  // dropping the delimiters. Re-emit a source token from the content, keeping
  // the original delimiter style (verbatim stays verbatim). Every other kind
  // round-trips its raw token unchanged.
  const newText = arg.editableKind === 'string'
    ? requoteString(intent.newText, arg.valueRaw ?? '')
    : intent.newText;
  return { ok: true, patches: [{ start: arg.valueSpan.start, end: arg.valueSpan.end, newText }] };
}
