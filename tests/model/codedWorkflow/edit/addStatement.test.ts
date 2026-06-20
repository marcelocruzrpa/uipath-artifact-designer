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

it('appends a statement at the end of the entry-point body', async () => {
  const model = await modelOf(SRC);
  const ep = model.classes[0].entryPoints[0];
  const res = resolveEdit(SRC, model, {
    kind: 'addStatement',
    slot: { containerId: '', methodId: 'W#Execute/', },
    index: ep.body.length,
    source: 'Log("c");'
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '    Log("b");',
    '    Log("c");',
    '  }',
    '}'
  ].join('\n'));
});

it('inserts a statement before the first', async () => {
  const model = await modelOf(SRC);
  const res = resolveEdit(SRC, model, {
    kind: 'addStatement',
    slot: { containerId: '', methodId: 'W#Execute/' },
    index: 0,
    source: 'Log("z");'
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("z");',
    '    Log("a");',
    '    Log("b");',
    '  }',
    '}'
  ].join('\n'));
});

it('inserts into an EMPTY nested slot at the block indent + one step, no trailing-ws', async () => {
  // An empty `if (x) { }` body has no first statement to copy indent from. The
  // inserted line must sit at the block's own indent (4sp) + one step (here 2sp,
  // the file's unit) = 6sp, and must NOT leave a trailing-whitespace blank line.
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    if (x) {',
    '    }',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const ifc = model.classes[0].entryPoints[0].body[0];
  if (ifc.type !== 'container') throw new Error('expected an if container');
  const res = resolveEdit(src, model, {
    kind: 'addStatement',
    slot: { containerId: ifc.id, methodId: '', role: 'then' },
    index: 0,
    source: 'Log("z");'
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const after = applyPatches(src, res.patches);
  expect(after).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    if (x) {',
    '      Log("z");',
    '    }',
    '  }',
    '}'
  ].join('\n'));
  // No line may carry trailing whitespace.
  expect(after.split('\n').every((l) => l === l.replace(/[ \t]+$/, ''))).toBe(true);
  // And it must reparse without introducing a syntax error.
  const tree = (await getCSharpParser()).parse(after);
  try { expect(tree.rootNode.hasError).toBe(false); } finally { tree.delete(); }
});
