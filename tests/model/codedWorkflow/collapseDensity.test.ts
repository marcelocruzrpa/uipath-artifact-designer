/**
 * F2 — per-method-density collapse (`buildModel.applyCollapsePass` +
 * limits.ts). A DENSE method (> COLLAPSE_METHOD_STATEMENTS leaves) collapses
 * its nested containers (depth >= 2) even in an otherwise small file; any
 * container nested at depth >= COLLAPSE_DEEP_NESTING is always collapsed; a
 * small method stays fully expanded. The top-level frame stays visible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import { COLLAPSE_METHOD_STATEMENTS } from '../../../src/model/codedWorkflow/limits';
import type {
  CodedWorkflowModel,
  CwContainer,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(source: string): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, { fileName: 'M.cs', fileUri: 'file:///proj/M.cs' });
  } finally {
    tree.delete();
  }
}

function entryBody(model: CodedWorkflowModel): CwStatement[] {
  return model.classes[0].entryPoints[0].body;
}

describe('per-method-density collapse', () => {
  it('collapses depth>=2 containers in a dense method, keeping the top frame open', async () => {
    // > COLLAPSE_METHOD_STATEMENTS literal-init leaves makes the method dense.
    const inits = Array.from(
      { length: COLLAPSE_METHOD_STATEMENTS + 3 },
      (_, i) => `    int v${i} = ${i};`
    ).join('\n');
    const model = await build(
      [
        'public class M : CodedWorkflow {',
        '  [Workflow] public void E() {',
        inits,
        '    while (cond) {', // depth 1 — stays open (the visible frame)
        '      if (ok) {', //    depth 2 — collapses (dense method)
        '        workflows.Foo();',
        '      }',
        '    }',
        '  }',
        '}'
      ].join('\n')
    );
    const whileC = entryBody(model).find(
      (s): s is CwContainer => s.type === 'container' && s.kind === 'while'
    );
    expect(whileC?.collapsedByDefault).toBe(false);
    const ifC = whileC?.slots[0].children.find(
      (s): s is CwContainer => s.type === 'container' && s.kind === 'if'
    );
    expect(ifC?.collapsedByDefault).toBe(true);
  });

  it('always collapses a container nested at depth >= 3, even in a small method', async () => {
    const model = await build(
      [
        'public class M : CodedWorkflow {',
        '  [Workflow] public void E() {',
        '    if (a) {', //     depth 1
        '      if (b) {', //   depth 2
        '        if (c) {', // depth 3 — always collapsed
        '          workflows.Foo();',
        '        }',
        '      }',
        '    }',
        '  }',
        '}'
      ].join('\n')
    );
    const d1 = entryBody(model).find(
      (s): s is CwContainer => s.type === 'container'
    );
    const d2 = d1?.slots[0].children.find((s): s is CwContainer => s.type === 'container');
    const d3 = d2?.slots[0].children.find((s): s is CwContainer => s.type === 'container');
    expect(d1?.collapsedByDefault).toBe(false);
    expect(d2?.collapsedByDefault).toBe(false);
    expect(d3?.collapsedByDefault).toBe(true);
  });

  it('keeps a small, shallow method fully expanded', async () => {
    const model = await build(
      'public class M : CodedWorkflow { [Workflow] public void E() {' +
        ' if (a) { workflows.Foo(); } } }'
    );
    const ifC = entryBody(model).find((s): s is CwContainer => s.type === 'container');
    expect(ifC?.collapsedByDefault).toBe(false);
  });
});
