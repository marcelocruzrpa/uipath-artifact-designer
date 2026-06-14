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
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 0, newText: '"bye"' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(source, res.patches)).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("bye"); } }'
  );
});

it('rejects an out-of-range arg index', async () => {
  const source = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 99, newText: 'x' });
  expect(res.ok).toBe(false);
});
