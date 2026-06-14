import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';
import type { CwActivityCard, CodedWorkflowModel } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

const wrap = (s: string) => `class W : CodedWorkflow { [Workflow] public void Execute() { ${s} } }`;

async function build(src: string): Promise<{ model: CodedWorkflowModel; card: CwActivityCard }> {
  const tree = (await getCSharpParser()).parse(src);
  try {
    const model = buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    return { model, card: model.classes[0].entryPoints[0].body[0] as CwActivityCard };
  } finally {
    tree.delete();
  }
}

it('changes an argument in place, touching only its span', async () => {
  // An uncataloged member surfaces BOTH args (arg1/arg2) as editable rows, so
  // argIndex 1 maps to a real CwArgSummary. (AddQueueItem catalogs only arg 0,
  // so its second argument is not a surfaced row and cannot be addressed.)
  const src = wrap('system.DoThing("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 1, newText: 'other' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.DoThing("Q", other);'));
});

it('adds a trailing argument to a single-arg call', async () => {
  const src = wrap('system.AddQueueItem("Q");');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: 'item' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.AddQueueItem("Q", item);'));
});

it('adds the first argument to an empty call', async () => {
  const src = wrap('Log();');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: '"hi"' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('Log("hi");'));
});

it('removes the last argument (and its leading comma)', async () => {
  const src = wrap('system.DoThing("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'remove', argIndex: 1 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.DoThing("Q");'));
});

it('removes the first of two arguments (and its following comma)', async () => {
  const src = wrap('system.DoThing("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'remove', argIndex: 0 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  // Removing the first arg drops it and the following comma+space.
  expect(applyPatches(src, res.patches)).toBe(wrap('system.DoThing(item);'));
});

it('switches the method name, leaving args intact', async () => {
  const src = wrap('var a = system.GetAsset("k");');
  const { model } = await build(src);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'method', newMethod: 'GetCredential' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('var a = system.GetCredential("k");'));
});

it('rejects change on a row with no argSpan', async () => {
  const src = wrap('Log("hi");');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 99, newText: 'x' });
  expect(res.ok).toBe(false);
});

it('rejects an editArg on a non-activity node', async () => {
  const src = wrap('var t = DateTime.Now;'); // tier-2 pseudo-step
  const { model } = await build(src);
  const node = model.classes[0].entryPoints[0].body[0];
  const res = resolveEdit(src, model, { kind: 'editArg', id: node.id, op: 'remove', argIndex: 0 });
  expect(res.ok).toBe(false);
});
