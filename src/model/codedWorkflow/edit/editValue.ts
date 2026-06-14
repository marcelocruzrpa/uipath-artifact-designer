import type { CodedWorkflowModel } from '../cwTypes';
import type { EditValueIntent, EditResult } from './editTypes';
import { findNodeById } from './findNode';

export function editValue(
  _source: string, model: CodedWorkflowModel, intent: EditValueIntent
): EditResult {
  const node = findNodeById(model, intent.id);
  if (node === null) return { ok: false, error: `node not found: ${intent.id}` };
  if (node.type !== 'activity') return { ok: false, error: 'only activity cards are value-editable in L0' };
  const arg = node.args[intent.argIndex];
  if (arg === undefined || arg.valueSpan === undefined || arg.editableKind === 'none')
    return { ok: false, error: `arg ${intent.argIndex} is not editable` };
  return { ok: true, patches: [{ start: arg.valueSpan.start, end: arg.valueSpan.end, newText: intent.newText }] };
}
