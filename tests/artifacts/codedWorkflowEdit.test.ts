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
  const computed = await computeValueEdit(SOURCE, { type: 'editValue', id, argIndex: 0, newText: '"bye"' });
  expect(computed.ok).toBe(true);
  if (!computed.ok) return;
  expect(computed.after).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("bye"); } }'
  );
  // The patch must touch only the value span, not the whole call.
  expect(computed.patches).toHaveLength(1);
  expect(SOURCE.slice(computed.patches[0].start, computed.patches[0].end)).toBe('"hi"');
});

it('rejects an edit that would break the C# syntax (parse-gate)', async () => {
  const id = await cardIdOf(SOURCE);
  // Unterminated string literal — parses with a new error that the source lacked.
  const computed = await computeValueEdit(SOURCE, { type: 'editValue', id, argIndex: 0, newText: '"bye' });
  expect(computed.ok).toBe(false);
  if (computed.ok) return;
  expect(computed.error).toBe('edit would break the C# syntax');
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
