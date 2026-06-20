import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../model/codedWorkflow/helpers';
import { getCSharpParser } from '../../src/model/codedWorkflow/parser';
import { buildModel } from '../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../src/model/codedWorkflow/cwTypes';
import { computeValueEdit } from '../../src/artifacts/codedWorkflowEdit';

beforeAll(() => configureCSharpParserFromNodeModules());

/** Build the model the same way the host helper does, to read the card id. */
async function cardIdOf(source: string): Promise<string> {
  const tree = (await getCSharpParser()).parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
    return (model.classes[0].entryPoints[0].body[0] as CwActivityCard).id;
  } finally {
    tree.delete();
  }
}

const SOURCE = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';

it('computes a minimal patch that rewrites only the edited literal', async () => {
  const id = await cardIdOf(SOURCE);
  // String fields carry CONTENT now; the host auto-quotes `bye` into `"bye"`.
  const computed = await computeValueEdit(SOURCE, { type: 'editValue', id, argIndex: 0, newText: 'bye' });
  expect(computed.ok).toBe(true);
  if (!computed.ok) return;
  expect(computed.after).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("bye"); } }'
  );
  // The patch must touch only the value span, not the whole call.
  expect(computed.patches).toHaveLength(1);
  expect(SOURCE.slice(computed.patches[0].start, computed.patches[0].end)).toBe('"hi"');
});

// Strings can no longer break syntax (the host quotes them), so a malformed
// value is exercised through a NON-string arg: an identifier edited to raw text
// that leaves an unterminated literal. Identifier edits are written verbatim.
const IDENT_GATE_SOURCE =
  'class W : CodedWorkflow { [Workflow] public void Execute() { Log(name); } }';

it('rejects a value that is not a single well-formed expression', async () => {
  const id = await cardIdOf(IDENT_GATE_SOURCE);
  // `"bye` (raw, no requote for an identifier) is not a single self-contained
  // expression — the single-expression guard catches it before the parse-gate
  // (it would also leave an unterminated literal in the document).
  const computed = await computeValueEdit(IDENT_GATE_SOURCE, { type: 'editValue', id, argIndex: 0, newText: '"bye' });
  expect(computed.ok).toBe(false);
  if (computed.ok) return;
  expect(computed.error).toBe('value must be a single expression');
});

it('rejects an unknown node id with the resolver error', async () => {
  const computed = await computeValueEdit(SOURCE, {
    type: 'editValue',
    id: 'W#Execute/999',
    argIndex: 0,
    newText: '"bye"'
  });
  expect(computed.ok).toBe(false);
  if (computed.ok) return;
  expect(computed.error).toContain('node not found');
});

// --- Part B: type-preservation guard (covers number/bool/identifier/enum) ---
//
// `system.SetTransactionStatus(item)` surfaces arg 0 `Transaction` as an
// IDENTIFIER (editableKind 'identifier'); confirmed by building the model below.
// Editing it to a numeric literal `42` changes the kind identifier→number and
// must be rejected even though `SetTransactionStatus(42)` is valid C# syntax
// (the parse-gate alone would let it through).
const IDENT_SOURCE =
  'class W : CodedWorkflow { [Workflow] public void Execute() { system.SetTransactionStatus(item); } }';

it('the chosen card arg really is an identifier (test-fixture self-check)', async () => {
  const tree = (await getCSharpParser()).parse(IDENT_SOURCE);
  try {
    const model = buildModel(tree, IDENT_SOURCE, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
    const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
    expect(card.method).toBe('SetTransactionStatus');
    expect(card.args[0].editableKind).toBe('identifier');
  } finally {
    tree.delete();
  }
});

it('rejects an edit that changes the value type (identifier → number)', async () => {
  const id = await cardIdOf(IDENT_SOURCE);
  // `42` parses fine (valid C#), but flips identifier → number — must be caught
  // by the type-preservation guard, not the parse-gate.
  const computed = await computeValueEdit(IDENT_SOURCE, { type: 'editValue', id, argIndex: 0, newText: '42' });
  expect(computed.ok).toBe(false);
  if (computed.ok) return;
  expect(computed.error).toBe('edit changed the value type (e.g. a string lost its quotes)');
});

it('accepts an edit that preserves the value type (identifier → identifier)', async () => {
  const id = await cardIdOf(IDENT_SOURCE);
  const computed = await computeValueEdit(IDENT_SOURCE, { type: 'editValue', id, argIndex: 0, newText: 'status' });
  expect(computed.ok).toBe(true);
  if (!computed.ok) return;
  expect(computed.after).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { system.SetTransactionStatus(status); } }'
  );
});

it('a dropped-quotes string edit stays a string (Part A) and is accepted', async () => {
  // End-to-end: editing the Log message to bare `oops` (content) re-quotes to a
  // literal, so the type-preservation guard never trips for strings.
  const id = await cardIdOf(SOURCE);
  const computed = await computeValueEdit(SOURCE, { type: 'editValue', id, argIndex: 0, newText: 'oops' });
  expect(computed.ok).toBe(true);
  if (!computed.ok) return;
  expect(computed.after).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("oops"); } }'
  );
});
