import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';

beforeAll(() => configureCSharpParserFromNodeModules());

const SRC = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    Log("a");',
  '    Log("b");',
  '  }',
  '}'
].join('\n');

async function modelOf(src: string) {
  const tree = (await getCSharpParser()).parse(src);
  try { return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}

it('deletes a statement, leaving no blank line', async () => {
  const model = await modelOf(SRC);
  const second = model.classes[0].entryPoints[0].body[1];
  const res = resolveEdit(SRC, model, { kind: 'deleteStatement', id: second.id });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '  }',
    '}'
  ].join('\n'));
});

// Fence F: a MERGED tier-3 chip deletes as a unit (it carries offsets — L2.1).
it('deletes a merged raw chip as a single unit', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("keep");',
    '    Foo();',
    '    Bar();',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const body = model.classes[0].entryPoints[0].body;
  // body = [ Log card, merged(Foo();Bar()) chip ]
  const chip = body[1];
  expect(chip.type).toBe('raw');
  const res = resolveEdit(src, model, { kind: 'deleteStatement', id: chip.id });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("keep");',
    '  }',
    '}'
  ].join('\n'));
});

// Fence F (honest exemption): a TRUNCATED fold chip has no offsets (the folded
// region is read-only), so its delete is REJECTED rather than silently mangling
// source. A fold chip is defined by offsets === undefined; assert the resolver
// rejects that, without coupling the test to MAX_RENDER_STATEMENTS' exact value.
it('rejects deleting a statement with no source offsets (e.g. a truncated fold chip)', async () => {
  const model = await modelOf(SRC);
  // Simulate the fold chip: a body node whose offsets were never populated.
  const ep = model.classes[0].entryPoints[0];
  const fold = { ...ep.body[0], id: 'W#Execute/fold', offsets: undefined };
  ep.body.push(fold as typeof ep.body[number]);
  const res = resolveEdit(SRC, model, { kind: 'deleteStatement', id: 'W#Execute/fold' });
  expect(res.ok).toBe(false);
});
