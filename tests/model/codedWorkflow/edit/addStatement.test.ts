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
