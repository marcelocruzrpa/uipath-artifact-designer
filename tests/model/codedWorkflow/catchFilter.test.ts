/**
 * HONESTY regression: a `catch` with a `when (...)` exception filter is
 * CONDITIONAL — it only handles the exception when the filter is true.  The
 * catch slot label MUST include the filter text verbatim, otherwise the canvas
 * would read as if the handler were unconditional (a lie about control flow).
 *
 * `buildModel`'s `catchLabel` appends the exact source of the
 * `catch_filter_clause` to the label.  This test covers:
 *   - a typed, named catch WITH a filter: `catch (Exception ex) when (...)`
 *   - a BARE filtered catch (filter, no declaration): `catch when (...)`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CodedWorkflowModel, CwContainer } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function build(source: string): Promise<CodedWorkflowModel> {
  const tree = (await getCSharpParser()).parse(source);
  try {
    return buildModel(tree, source, { fileName: 'catch.cs', fileUri: 'file:///catch.cs' });
  } finally {
    tree.delete();
  }
}

/** The single try container at the top of Execute(). */
function tryContainer(model: CodedWorkflowModel): CwContainer {
  const node = model.classes[0].entryPoints[0].body[0];
  if (node.type !== 'container' || node.kind !== 'try') {
    throw new Error('expected a try container');
  }
  return node;
}

describe('catch when-filter label honesty', () => {
  it('includes the when(...) filter on a typed, named catch', async () => {
    const src = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    try { Log("a"); }',
      '    catch (Exception ex) when (ex.HResult == 5) { Log("b"); }',
      '  }',
      '}'
    ].join('\n');
    const model = await build(src);
    const ctr = tryContainer(model);
    const catchSlot = ctr.slots.find((s) => s.role === 'catch')!;
    expect(catchSlot.label).toContain('Catch Exception ex');
    // The filter must survive verbatim — dropping it would read as unconditional.
    expect(catchSlot.label).toContain('when (ex.HResult == 5)');
  });

  it('keeps the when(...) filter on a BARE catch (no declaration)', async () => {
    const src = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    try { Log("a"); }',
      '    catch when (Ready()) { Log("b"); }',
      '  }',
      '}'
    ].join('\n');
    const model = await build(src);
    const ctr = tryContainer(model);
    const catchSlot = ctr.slots.find((s) => s.role === 'catch')!;
    expect(catchSlot.label).toContain('Catch');
    expect(catchSlot.label).toContain('when (Ready())');
  });
});
