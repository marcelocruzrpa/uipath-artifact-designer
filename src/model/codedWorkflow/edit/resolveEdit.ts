import type { CodedWorkflowModel } from '../cwTypes';
import type { EditIntent, EditResult } from './editTypes';
import { editValue } from './editValue';

export function resolveEdit(
  source: string, model: CodedWorkflowModel, intent: EditIntent
): EditResult {
  switch (intent.kind) {
    case 'editValue': return editValue(source, model, intent);
    default: return { ok: false, error: `unsupported edit: ${(intent as { kind: string }).kind}` };
  }
}
