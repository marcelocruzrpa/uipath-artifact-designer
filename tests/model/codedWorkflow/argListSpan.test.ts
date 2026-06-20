import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function cardOf(source: string): Promise<{ card: CwActivityCard; source: string }> {
  const tree = (await getCSharpParser()).parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    return { card: model.classes[0].entryPoints[0].body[0] as CwActivityCard, source };
  } finally {
    tree.delete();
  }
}

it('captures the argument-list interior span', async () => {
  const src = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const { card, source } = await cardOf(src);
  expect(card.argListSpan).toBeDefined();
  // The interior is exactly the source between the parens.
  expect(source.slice(card.argListSpan!.start, card.argListSpan!.end)).toBe('"hi"');
});

it('captures each argument node span', async () => {
  const src =
    'class W : CodedWorkflow { [Workflow] public void Execute() { system.AddQueueItem("Q", item); } }';
  const { card, source } = await cardOf(src);
  expect(card.args[0].argSpan).toBeDefined();
  expect(source.slice(card.args[0].argSpan!.start, card.args[0].argSpan!.end)).toBe('"Q"');
});

it('reports an empty interior span for a no-arg call', async () => {
  const src =
    'class W : CodedWorkflow { [Workflow] public void Execute() { var x = system.GetTransactionItem(); } }';
  const { card } = await cardOf(src);
  expect(card.argListSpan).toBeDefined();
  expect(card.argListSpan!.start).toBe(card.argListSpan!.end);
});
