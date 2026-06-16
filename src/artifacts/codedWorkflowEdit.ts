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
import { getCSharpParser, type CSharpParserHandle } from '../model/codedWorkflow/parser';
import { buildModel } from '../model/codedWorkflow/buildModel';
import { resolveEdit } from '../model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../model/codedWorkflow/edit/applyPatches';
import { introducesNewError } from '../model/codedWorkflow/edit/parseGate';
import { findNodeById } from '../model/codedWorkflow/edit/findNode';
import type { EditIntent } from '../model/codedWorkflow/edit/editTypes';
import type { CodedWorkflowModel } from '../model/codedWorkflow/cwTypes';
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
 * Total leaf-statement count of a model. `model.stats.totalStatements` already
 * counts leaves recursively (tier-1 cards, tier-2 pseudo, tier-3 raw lines)
 * through every container slot, so an injected sibling statement (a smuggled
 * `Evil();` call) increments it. This is the robust, intent-agnostic signal the
 * count invariant compares before vs after an edit.
 */
function statementCount(model: CodedWorkflowModel): number {
  return model.stats.totalStatements;
}

/** Build a model from already-parsed `source` text (disposes the tree). */
function modelOf(parser: CSharpParserHandle, source: string): CodedWorkflowModel {
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
}

/**
 * The tree-sitter node TYPE backing a value span (`integer_literal`,
 * `identifier`, `binary_expression`, …). The model's `OffsetSpan` is built from
 * `node.startIndex`/`node.endIndex` — the same JS-string index space tree-sitter
 * uses — so `namedDescendantForIndex` over the span recovers the original node.
 * Returns `undefined` when nothing resolves (e.g. an inclusive end nudges off the
 * node); the caller treats `undefined` as "skip the syntactic check".
 */
function nodeTypeAtSpan(
  parser: CSharpParserHandle,
  source: string,
  span: { start: number; end: number }
): string | undefined {
  const tree = parser.parse(source);
  try {
    // `end - 1` keeps the lookup inside the node's last char (the end index is
    // exclusive). A zero-width span (start === end) is degenerate — skip it.
    if (span.end <= span.start) return undefined;
    const node = tree.rootNode.namedDescendantForIndex(span.start, span.end - 1);
    return node?.type;
  } finally {
    tree.delete();
  }
}

/**
 * True when `newText` is a single, self-contained C# EXPRESSION — the only thing
 * a value/arg edit is allowed to be. We wrap it as `var __x = (<newText>);`
 * inside a throwaway class+method and assert the method body parses to EXACTLY
 * ONE statement with no errors. A raw-statement injection like
 * `other); Evil(); Log(item` closes the paren early and parses to THREE
 * statements (a declaration plus two calls), so it is rejected here even though
 * the surrounding file still parses clean. Belt-and-suspenders alongside the
 * statement-count invariant — this catches reshapes that keep the count equal.
 */
function parsesAsSingleExpression(parser: CSharpParserHandle, newText: string): boolean {
  const wrapped = `class __P { void __m() { var __x = (${newText}); } }`;
  const tree = parser.parse(wrapped);
  try {
    const root = tree.rootNode;
    if (root.hasError) return false;
    // compilation_unit > class_declaration > declaration_list > method_declaration > block
    const block = root
      .descendantsOfType('block')
      .find((b) => b.parent?.type === 'method_declaration');
    if (block === undefined) return false;
    // The block's named children are its statements; exactly one is required.
    return block.namedChildCount === 1;
  } finally {
    tree.delete();
  }
}

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
  const model = modelOf(parser, source);
  // Capture the edited arg's ORIGINAL editable kind AND value span from the
  // pre-edit model, so we can reject edits that silently change the value's type
  // (Part B guard) and recover the backing syntactic node-type for a tighter
  // structural check.
  const origNode = findNodeById(model, message.id);
  const origArg = origNode?.type === 'activity' ? origNode.args[message.argIndex] : undefined;
  const origKind = origArg?.editableKind;
  const origSpan = origArg?.valueSpan;
  const origSyntax = origSpan !== undefined ? nodeTypeAtSpan(parser, source, origSpan) : undefined;
  // Belt-and-suspenders raw-injection guard: a non-string value is written
  // verbatim, so reject anything that is not a single self-contained expression
  // (`other); Evil(); Log(item` closes the paren early and smuggles statements).
  // Strings route through requoteString (always one quoted literal), so they are
  // exempt — and their content legitimately contains `;`, `)` etc.
  if (origKind !== undefined && origKind !== 'string' && origKind !== 'none'
    && !parsesAsSingleExpression(parser, message.newText)) {
    return { ok: false, error: 'value must be a single expression' };
  }
  const beforeCount = statementCount(model);
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
  const afterModel = modelOf(parser, after);
  // Statement-count invariant: a value edit must NOT change how many statements
  // the file has. An injected sibling (`Evil();`) would bump the count even when
  // the same arg still resolves as the same editable kind.
  if (statementCount(afterModel) !== beforeCount) {
    return { ok: false, error: 'edit changed the statement count' };
  }
  const newNode = findNodeById(afterModel, message.id);
  const newArg = newNode?.type === 'activity' ? newNode.args[message.argIndex] : undefined;
  const newKind = newArg?.editableKind;
  if (origKind !== undefined && newKind !== origKind) {
    return { ok: false, error: 'edit changed the value type (e.g. a string lost its quotes)' };
  }
  // Tighter type-preservation: the backing value node's SYNTACTIC node-type must
  // also be preserved, so a literal field cannot morph into an arbitrary
  // expression of the SAME editableKind. A `binary_expression` may keep editing
  // its operands (still a binary_expression), but an `integer_literal` cannot
  // become a `binary_expression`. Only enforced when both spans resolve.
  const newSpan = newArg?.valueSpan;
  const newSyntax = newSpan !== undefined ? nodeTypeAtSpan(parser, after, newSpan) : undefined;
  if (origSyntax !== undefined && newSyntax !== undefined && newSyntax !== origSyntax) {
    return { ok: false, error: 'edit changed the value expression kind' };
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
  const model = modelOf(parser, source);
  // Belt-and-suspenders raw-injection guard for the ops that splice raw text:
  // `add`/`change` write an argument expression, so reject anything that is not
  // a single self-contained expression (`x); Evil(); Log(` smuggles statements).
  if ((message.op === 'add' || message.op === 'change') && message.newText !== undefined
    && !parsesAsSingleExpression(parser, message.newText)) {
    return { ok: false, error: 'argument must be a single expression' };
  }
  const beforeCount = statementCount(model);
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
  const afterModel = modelOf(parser, after);
  // Statement-count invariant: an argument edit reshapes ONE call, never the
  // statement list — an injected sibling statement would change the count.
  if (statementCount(afterModel) !== beforeCount) {
    return { ok: false, error: 'edit changed the statement count' };
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

/** Expected change in total statement count for each statement intent. */
function expectedCountDelta(intent: EditIntent): number {
  switch (intent.kind) {
    case 'addStatement': return 1;     // exactly one statement appears
    case 'deleteStatement': return -1; // exactly one statement disappears
    default: return 0;                 // moveStatement reorders, never re-counts
  }
}

/**
 * Shared engine for the three statement intents: build the model fresh, resolve
 * the intent to minimal patches, and run the syntax parse-gate. On top of that,
 * enforce the per-intent STATEMENT-COUNT INVARIANT — add must be exactly +1,
 * delete exactly −1, move unchanged — by rebuilding the after-model and
 * comparing leaf counts. This is what stops a raw insert from smuggling in MORE
 * than one statement (`Foo(); Evil();`), or a move/delete from quietly dropping
 * or duplicating code; the parse-gate alone only guards well-formedness.
 */
async function computeStatementEdit(source: string, intent: EditIntent): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const model = modelOf(parser, source);
  const beforeCount = statementCount(model);
  const res = resolveEdit(source, model, intent);
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  const afterModel = modelOf(parser, after);
  if (statementCount(afterModel) - beforeCount !== expectedCountDelta(intent)) {
    return { ok: false, error: 'edit changed the statement count unexpectedly' };
  }
  return { ok: true, patches: res.patches, after };
}
