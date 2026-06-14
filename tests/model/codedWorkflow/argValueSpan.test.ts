import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

it('captures the value span + editableKind of a Log message literal', async () => {
  const source =
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
    const arg = card.args[0];
    expect(arg.editableKind).toBe('string');
    expect(arg.valueSpan).toBeDefined();
    expect(source.slice(arg.valueSpan!.start, arg.valueSpan!.end)).toBe('"hi"');
  } finally {
    tree.delete();
  }
});
