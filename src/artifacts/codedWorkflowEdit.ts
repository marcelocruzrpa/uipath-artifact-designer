/**
 * Host-side helper that turns an `editValue` webview message into a minimal,
 * parse-gated text patch for a coded-workflow `.cs` document.
 *
 * It composes only the parser singleton and the PURE edit modules — there is
 * NO `vscode` import here — so it is unit-testable with
 * `configureCSharpParserFromNodeModules`. The generic provider stays thin: it
 * reads the document text, calls {@link computeValueEdit}, and either surfaces
 * the rejection or applies the returned range patches through a WorkspaceEdit.
 */
import { getCSharpParser } from '../model/codedWorkflow/parser';
import { buildModel } from '../model/codedWorkflow/buildModel';
import { resolveEdit } from '../model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../model/codedWorkflow/edit/applyPatches';
import { introducesNewError } from '../model/codedWorkflow/edit/parseGate';
import { findNodeById } from '../model/codedWorkflow/edit/findNode';
import type { EditIntent } from '../model/codedWorkflow/edit/editTypes';
import type {
  AddStatementMessage,
  DeleteStatementMessage,
  EditArgMessage,
  EditValueMessage,
  MoveStatementMessage
} from '../util/messages';

/** A resolved value-edit: minimal patches plus the full resulting text. */
export type ComputedEdit =
  | { ok: true; patches: { start: number; end: number; newText: string }[]; after: string }
  | { ok: false; error: string };

/**
 * Build the model fresh from `source`, resolve the edit, run the parse-gate.
 *
 * Returns `{ ok: false, error }` when the node is not value-editable, the arg
 * index is out of range, or the edit would introduce a new C# syntax error
 * (the parse-gate). Otherwise returns the minimal `patches` and the full
 * `after` text the patches produce, so the caller can both apply the range
 * edit and prime its echo-guard with the exact resulting document.
 */
export async function computeValueEdit(source: string, message: EditValueMessage): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  let model;
  try {
    model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
  // Capture the edited arg's ORIGINAL editable kind from the pre-edit model, so
  // we can reject edits that silently change the value's type (Part B guard).
  const origNode = findNodeById(model, message.id);
  const origKind =
    origNode?.type === 'activity' ? origNode.args[message.argIndex]?.editableKind : undefined;
  // Node ids are class-qualified, not file-qualified, so the dummy fileName /
  // fileUri above never reach the id and are irrelevant to resolution.
  const res = resolveEdit(source, model, {
    kind: 'editValue',
    id: message.id,
    argIndex: message.argIndex,
    newText: message.newText
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  // Type-preservation guard (universal backstop): rebuild the model from the
  // edited text and reject if the same node/arg's editable kind changed — e.g.
  // a number became an identifier, or (without Part A) a string lost its quotes.
  // With Part A a string edit is always re-quoted, so this never trips for
  // strings; it guards numbers/bools/identifiers/enums and verbatim/raw edges.
  const treeAfter = parser.parse(after);
  let afterModel;
  try {
    afterModel = buildModel(treeAfter, after, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    treeAfter.delete();
  }
  const newNode = findNodeById(afterModel, message.id);
  const newKind =
    newNode?.type === 'activity' ? newNode.args[message.argIndex]?.editableKind : undefined;
  if (origKind !== undefined && newKind !== origKind) {
    return { ok: false, error: 'edit changed the value type (e.g. a string lost its quotes)' };
  }
  return { ok: true, patches: res.patches, after };
}

/**
 * Build the model fresh from `source`, resolve the `editArg`, run the parse-gate
 * and a structural backstop.
 *
 * Structural editing can reshape the statement (add/remove an argument, switch
 * the method), so on top of the syntax parse-gate this re-builds the model from
 * the patched text and confirms the SAME node id still resolves and is still an
 * activity — a cheap, sufficient guard that the edit did not destroy the entry
 * point or re-shape ids around it. Returns `{ ok: false, error }` on any
 * rejection; otherwise the minimal `patches` plus the full `after` text.
 */
export async function computeArgEdit(source: string, message: EditArgMessage): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  let model;
  try {
    model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
  const res = resolveEdit(source, model, {
    kind: 'editArg',
    id: message.id,
    op: message.op,
    ...(message.argIndex !== undefined ? { argIndex: message.argIndex } : {}),
    ...(message.newText !== undefined ? { newText: message.newText } : {}),
    ...(message.newMethod !== undefined ? { newMethod: message.newMethod } : {})
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  // Structural backstop: the patched source must still build a model with the
  // SAME node id present (an add/remove must not destroy the entry point or
  // re-shape ids around it). Cheaper + sufficient: assert the node still
  // resolves and is still an activity.
  const treeAfter = parser.parse(after);
  let afterModel;
  try {
    afterModel = buildModel(treeAfter, after, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    treeAfter.delete();
  }
  const stillThere = findNodeById(afterModel, message.id);
  if (stillThere === null || stillThere.type !== 'activity') {
    return { ok: false, error: 'edit reshaped the workflow structure unexpectedly' };
  }
  return { ok: true, patches: res.patches, after };
}

/** Insert a fully-emitted statement into a slot at an index (parse-gated). */
export async function computeAddStatement(source: string, message: AddStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, {
    kind: 'addStatement', slot: message.slot, index: message.index, source: message.source
  });
}

/** Delete a statement by id (parse-gated). */
export async function computeDeleteStatement(source: string, message: DeleteStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, { kind: 'deleteStatement', id: message.id });
}

/** Move a statement within its slot (parse-gated). */
export async function computeMoveStatement(source: string, message: MoveStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, { kind: 'moveStatement', id: message.id, direction: message.direction });
}

/**
 * Shared engine for the three statement intents: build the model fresh, resolve
 * the intent to minimal patches, and run the syntax parse-gate. Same shape as
 * {@link computeArgEdit} minus the type/structural backstop — add/delete/move
 * reshape the statement list by design, so a "same node still resolves" check
 * would be wrong here; the parse-gate alone guards well-formedness.
 */
async function computeStatementEdit(source: string, intent: EditIntent): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  let model;
  try {
    model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
  const res = resolveEdit(source, model, intent);
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  return { ok: true, patches: res.patches, after };
}
