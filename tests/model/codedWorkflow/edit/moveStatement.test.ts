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

it('moves the second statement up above the first', async () => {
  const model = await modelOf(SRC);
  const second = model.classes[0].entryPoints[0].body[1];
  const res = resolveEdit(SRC, model, { kind: 'moveStatement', id: second.id, direction: -1 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("b");',
    '    Log("a");',
    '  }',
    '}'
  ].join('\n'));
});

it('rejects moving the first statement up (out of bounds)', async () => {
  const model = await modelOf(SRC);
  const first = model.classes[0].entryPoints[0].body[0];
  const res = resolveEdit(SRC, model, { kind: 'moveStatement', id: first.id, direction: -1 });
  expect(res.ok).toBe(false);
});
