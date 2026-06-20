import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';
import type { CwActivityCard } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(source: string) {
  const tree = (await getCSharpParser()).parse(source);
  try { return buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}

it('edits a Log message literal in place, touching only its span', async () => {
  const source = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  // String fields now carry CONTENT, not the C# token: the host auto-quotes.
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 0, newText: 'bye' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(source, res.patches)).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("bye"); } }'
  );
});

it('auto-quotes string content so dropped quotes cannot decay a literal', async () => {
  const source = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  // User types bare `oops` (no quotes). The host re-quotes it into a literal.
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 0, newText: 'oops' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(source, res.patches)).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("oops"); } }'
  );
});

it('preserves a verbatim delimiter when re-quoting string content', async () => {
  const source = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log(@"C:\\a"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  // Content with a backslash stays literal in a verbatim re-emit (no escaping).
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 0, newText: 'C:\\b' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(source, res.patches)).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log(@"C:\\b"); } }'
  );
});

it('rejects an out-of-range arg index', async () => {
  const source = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 99, newText: 'x' });
  expect(res.ok).toBe(false);
});
