/**
 * F3 — REFramework state-machine recognition (`classify/stateMachine.ts`):
 * a loop-driven `switch` over an enum state variable gains a `stateMachine`
 * annotation (states + transitions) WITHOUT changing the underlying
 * switch/case/Assign model. Deviations from the exact shape produce no
 * annotation (the normal container tree renders).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
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

/** First container of `kind` anywhere in the first entry point's body. */
function firstContainer(model: CodedWorkflowModel, kind: CwContainer['kind']): CwContainer | null {
  const visit = (stmts: CwStatement[]): CwContainer | null => {
    for (const s of stmts) {
      if (s.type !== 'container') continue;
      if (s.kind === kind) return s;
      for (const slot of s.slots) {
        const hit = visit(slot.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return visit(model.classes[0].entryPoints[0].body);
}

const REFRAMEWORK = [
  'public class M : CodedWorkflow {',
  '  private enum State { Init, Work, Done }',
  '  [Workflow] public void Execute() {',
  '    var state = State.Init;',
  '    while (true) {',
  '      switch (state) {',
  '        case State.Init:',
  '          workflows.Setup();',
  '          state = State.Work;',
  '          break;',
  '        case State.Work:',
  '          if (ok) state = State.Done; else state = State.Init;',
  '          break;',
  '        case State.Done:',
  '          return;',
  '      }',
  '    }',
  '  }',
  '}'
].join('\n');

describe('state-machine recognition (positive)', () => {
  it('annotates a loop-driven enum switch with states and transitions', async () => {
    const sw = firstContainer(await build(REFRAMEWORK), 'switch');
    expect(sw?.stateMachine).toBeDefined();
    expect(sw?.stateMachine?.stateVar).toBe('state');
    expect(sw?.stateMachine?.states).toEqual([
      { label: 'Init', transitions: ['Work'] },
      { label: 'Work', transitions: ['Done', 'Init'] },
      { label: 'Done', transitions: [] }
    ]);
  });

  it('leaves the switch/case model intact (annotation is additive)', async () => {
    const sw = firstContainer(await build(REFRAMEWORK), 'switch');
    expect(sw?.kind).toBe('switch');
    expect(sw?.slots.map((s) => s.label)).toEqual([
      'Case State.Init',
      'Case State.Work',
      'Case State.Done'
    ]);
  });
});

describe('state-machine recognition (negatives — no annotation)', () => {
  it('does not annotate a switch that is NOT inside a loop', async () => {
    const sw = firstContainer(
      await build(
        'public class M : CodedWorkflow { private enum S { A, B } [Workflow] public void E() {' +
          ' var s = S.A; switch (s) { case S.A: s = S.B; break; case S.B: break; } } }'
      ),
      'switch'
    );
    expect(sw?.stateMachine).toBeUndefined();
  });

  it('does not annotate a loop with no switch (a try-based transaction loop)', async () => {
    const model = await build(
      'public class M : CodedWorkflow { [Workflow] public void E() {' +
        ' while (true) { try { workflows.Step(); } catch (Exception ex) { break; } } } }'
    );
    expect(firstContainer(model, 'switch')).toBeNull();
  });

  it('does not annotate a switch whose cases are not Enum.Member labels', async () => {
    const sw = firstContainer(
      await build(
        'public class M : CodedWorkflow { [Workflow] public void E() {' +
          ' int n = 0; while (true) { switch (n) { case 0: n = 1; break; case 1: return; } } } }'
      ),
      'switch'
    );
    expect(sw?.stateMachine).toBeUndefined();
  });
});
