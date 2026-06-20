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

it('rejects change on a NAMED argument (would drop the `name:`)', async () => {
  // A C# named arg's argSpan covers `name: value`; an op:'change' replaces the
  // WHOLE span, so it would silently drop the `name:`. Defend against it.
  // (Unreachable via the panel today — value edits route through editValue's
  // valueSpan — but the resolver is a public API and must not corrupt source.)
  const src = wrap('system.DoThing(foo: "x", b);');
  const { model, card } = await build(src);
  expect(src.slice(card.args[0].argSpan!.start, card.args[0].argSpan!.end)).toBe('foo: "x"');
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 0, newText: '"y"' });
  expect(res.ok).toBe(false);
});

it('method switch patches the OUTER call in a repeated-method chain (not the inner)', async () => {
  // The receiver chain repeats the method name, so the inner `GetData(` precedes
  // the real call. The old `source.indexOf("GetData(")` patched the inner call;
  // the stored methodNameSpan points at the outer (correct) occurrence.
  const src = wrap('var a = system.GetData().GetData("k");');
  const { model, card } = await build(src);
  expect(card.methodNameSpan).toBeDefined();
  expect(src.slice(card.methodNameSpan!.start, card.methodNameSpan!.end)).toBe('GetData');
  // span starts AFTER the inner `GetData(` occurrence.
  expect(card.methodNameSpan!.start).toBeGreaterThan(src.indexOf('GetData('));
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'method', newMethod: 'SetData' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('var a = system.GetData().SetData("k");'));
});

it('rejects change on a `@`-verbatim NAMED argument (regex would miss the `@`)', async () => {
  // `@event` is a C# verbatim identifier; the old text regex (`^\w+:`) misses the
  // leading `@`, so it would replace the whole `@event: "x"` span and drop the
  // name. The parser-derived `isNamed` flag catches it.
  const src = wrap('system.DoThing(@event: "x", b);');
  const { model, card } = await build(src);
  expect(card.args[0].isNamed).toBe(true);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 0, newText: '"y"' });
  expect(res.ok).toBe(false);
});

it('rejects add after a `@`-verbatim named argument (CS1738 positional-after-named)', async () => {
  const src = wrap('system.DoThing(@event: "x");');
  const { model, card } = await build(src);
  expect(card.hasNamedArg).toBe(true);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: 'b' });
  expect(res.ok).toBe(false);
});

it('removes the TRUE MIDDLE arg of a 3-arg call (general-N comma handling)', async () => {
  // Uncataloged member call: the generic extractor surfaces only the first two
  // rows (arg1/arg2), but removing the middle arg (index 1) by its argSpan must
  // still eat exactly one separating comma and leave `f(a, c)` well-formed.
  const src = wrap('system.DoThing("Q", b, c);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'remove', argIndex: 1 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.DoThing("Q", c);'));
});

