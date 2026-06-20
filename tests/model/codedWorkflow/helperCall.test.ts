/**
 * F1 — in-file helper-call navigation (`classify/helperCallDetect.ts`):
 * a bare call to a uniquely-named own-class helper gets a `helperTarget`
 * (tier-3, raw code preserved) pointing at the rendered `Helper:` section, and
 * such a chip is never merged into a multi-statement run. Ambiguous / unknown
 * / entry-named / non-bare calls stay plain chips.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwRawChip,
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

/** All raw chips in the first entry point's body, flattened in source order. */
function chips(model: CodedWorkflowModel): CwRawChip[] {
  const out: CwRawChip[] = [];
  const visit = (stmts: CwStatement[]): void => {
    for (const s of stmts) {
      if (s.type === 'raw') out.push(s);
      else if (s.type === 'container') s.slots.forEach((slot) => visit(slot.children));
    }
  };
  visit(model.classes[0].entryPoints[0].body);
  return out;
}

const SOURCE = [
  'public class M : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    Cleanup();',          // bare own-class helper → navigable
  '    this.Cleanup();',     // this.-prefixed own-class helper → navigable
  '    External();',         // unknown bare call → NOT navigable
  '    other.Cleanup();',    // call on another receiver → NOT navigable
  '  }',
  '  private void Cleanup() { workflows.Close(); }',
  '}'
].join('\n');

describe('helper-call detection', () => {
  let body: CwRawChip[];
  beforeAll(async () => {
    body = chips(await build(SOURCE));
  });

  it('flags a bare own-class helper call with the Helper section target id', () => {
    const c = body.find((c) => c.code.startsWith('Cleanup('));
    expect(c?.helperTarget).toEqual({ name: 'Cleanup', targetId: 'M#helper:Cleanup' });
  });

  it('flags a this.-prefixed helper call', () => {
    const c = body.find((c) => c.code.startsWith('this.Cleanup('));
    expect(c?.helperTarget?.name).toBe('Cleanup');
  });

  it('does NOT flag an unknown bare call', () => {
    const c = body.find((c) => c.code.startsWith('External('));
    expect(c?.helperTarget).toBeUndefined();
  });

  it('does NOT flag a call on another receiver', () => {
    const c = body.find((c) => c.code.startsWith('other.Cleanup('));
    expect(c?.helperTarget).toBeUndefined();
  });
});

describe('helper-call honesty + merge', () => {
  it('stays tier-3 (a local call is not a service call)', async () => {
    const c = chips(await build(SOURCE)).find((c) => c.code.startsWith('Cleanup('));
    expect(c?.tier).toBe(3);
  });

  it('never merges a helper-call chip with an adjacent raw statement', async () => {
    // `Cleanup(); return;` — the helper call must stay an individually
    // addressable chip, so it is NOT folded into one merged ×2 chip.
    const model = await build(
      'public class M : CodedWorkflow { [Workflow] public void E() {' +
        ' Cleanup(); return; } private void Cleanup() { workflows.Close(); } }'
    );
    const body = chips(model);
    const call = body.find((c) => c.code.startsWith('Cleanup('));
    expect(call?.helperTarget?.name).toBe('Cleanup');
    expect(call?.statementCount).toBe(1);
    // The `return;` survives as its own separate chip.
    expect(body.some((c) => c.code.trim() === 'return;')).toBe(true);
  });

  it('does NOT flag an overloaded (ambiguous) helper name', async () => {
    const model = await build(
      'public class M : CodedWorkflow { [Workflow] public void E() { Cleanup(); }' +
        ' private void Cleanup() { workflows.A(); } private void Cleanup(int n) { workflows.B(); } }'
    );
    const call = chips(model).find((c) => c.code.startsWith('Cleanup('));
    expect(call?.helperTarget).toBeUndefined();
  });
});
