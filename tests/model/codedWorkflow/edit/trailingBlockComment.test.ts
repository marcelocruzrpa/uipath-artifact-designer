/**
 * Regression locks for the trailing BLOCK-comment edit-safety gap found by
 * adversarial verification: moveStatement must not MISATTRIBUTE and
 * deleteStatement must not STRAND a trailing block comment. The original guard
 * matched only `//`, so a block comment slipped past the parse-gate and the
 * statement-count invariant (both pass — the C# stays valid and the statement
 * count is unchanged). The clean and line-comment cases are kept as controls so
 * the broadened guard can neither over- nor under-reject.
 */
import { it, expect, beforeAll, describe } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import type { CodedWorkflowModel } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(src: string): Promise<CodedWorkflowModel> {
  const tree = (await getCSharpParser()).parse(src);
  try {
    return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
  } finally {
    tree.delete();
  }
}

const wrap = (...stmts: string[]): string =>
  [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    ...stmts.map((s) => '    ' + s),
    '  }',
    '}'
  ].join('\n');

describe('trailing block-comment edit safety', () => {
  it('rejects moveStatement when a statement carries a trailing /* */ block comment', async () => {
    const src = wrap('Log("a"); /* note-A */', 'Log("b");');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'moveStatement', id: ep.body[0].id, direction: 1 });
    // Pre-fix this returned ok:true and swapped the bare slices, stranding
    // `/* note-A */` onto Log("b"). The broadened guard must reject it.
    expect(res.ok).toBe(false);
  });

  it('rejects deleteStatement when the statement carries a trailing /* */ block comment', async () => {
    const src = wrap('Log("a"); /* note-A */', 'Log("b");');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'deleteStatement', id: ep.body[0].id });
    expect(res.ok).toBe(false);
  });

  it('still rejects the line-comment form (no regression on //)', async () => {
    const src = wrap('Log("a"); // note-A', 'Log("b");');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'moveStatement', id: ep.body[0].id, direction: 1 });
    expect(res.ok).toBe(false);
  });

  it('still ALLOWS move of a clean statement (no over-rejection)', async () => {
    const src = wrap('Log("a");', 'Log("b");');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'moveStatement', id: ep.body[0].id, direction: 1 });
    expect(res.ok).toBe(true);
  });

  it('still ALLOWS delete of a clean statement (no over-rejection)', async () => {
    const src = wrap('Log("a");', 'Log("b");');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'deleteStatement', id: ep.body[0].id });
    expect(res.ok).toBe(true);
  });
});
