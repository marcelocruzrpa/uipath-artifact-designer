/**
 * Tests for "open the invoked workflow on double-click":
 *  - build-time DETECTION — `makeCard` flags invoke activities with
 *    `invokeKind` / `invokeCallee` (`workflows.Foo(...)` / `RunWorkflow("X")`,
 *    bound and bare), and leaves non-invoke activities unflagged; and
 *  - host-side RESOLUTION — `attachInvokeTargets` fills `invokeTarget` from the
 *    project graph (resolved / no-match / ambiguous / dynamic / missing-file).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import { attachInvokeTargets } from '../../../src/model/codedWorkflow/attachInvokeTargets';
import { DYNAMIC_WORKFLOW_NAME } from '../../../src/model/codedWorkflow/classify/invokeDetect';
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';
import type { CodedGraphNode, CodedProjectGraph } from '../../../src/model/codedWorkflow/graph/graphTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(source: string): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, { fileName: 'Flow.cs', fileUri: 'file:///proj/Flow.cs' });
  } finally {
    tree.delete();
  }
}

/** All tier-1 activity cards in a model, in source order, flattened. */
function activities(model: CodedWorkflowModel): CwActivityCard[] {
  const out: CwActivityCard[] = [];
  const visit = (stmts: CwStatement[]): void => {
    for (const s of stmts) {
      if (s.type === 'activity') out.push(s);
      else if (s.type === 'container') s.slots.forEach((slot) => visit(slot.children));
    }
  };
  for (const cls of model.classes) for (const ep of cls.entryPoints) visit(ep.body);
  return out;
}

const SOURCE = [
  'public class Flow : CodedWorkflow {',
  '  [Workflow]',
  '  public void Execute() {',
  '    workflows.Foo(1);',                 // workflows-member, bare
  '    var r = workflows.Bar(2);',         // workflows-member, bound
  '    this.workflows.Baz();',             // workflows-member via this.
  '    RunWorkflow("Sub/Child.xaml");',    // run-workflow, literal
  '    RunWorkflow(dynamicName);',         // run-workflow, dynamic
  '    system.GetAsset("ApiEndpoint");',   // NOT an invocation
  '  }',
  '}'
].join('\n');

function node(
  id: string,
  kind: CodedGraphNode['kind'],
  label: string,
  extra: Partial<CodedGraphNode> = {}
): CodedGraphNode {
  return { id, kind, label, isEntryPoint: false, stale: false, ...extra };
}

describe('invoke detection (build time)', () => {
  let cards: CwActivityCard[];
  beforeAll(async () => {
    cards = activities(await build(SOURCE));
  });

  it('flags workflows.Foo(...) as a workflows-member invocation by class name', () => {
    const foo = cards.find((c) => c.invokeCallee === 'Foo');
    expect(foo?.invokeKind).toBe('workflows-member');
  });

  it('flags a BOUND workflows call and keeps the result binding', () => {
    const bar = cards.find((c) => c.invokeCallee === 'Bar');
    expect(bar?.invokeKind).toBe('workflows-member');
    expect(bar?.resultBinding).toBe('r');
  });

  it('flags this.workflows.Baz()', () => {
    const baz = cards.find((c) => c.invokeCallee === 'Baz');
    expect(baz?.invokeKind).toBe('workflows-member');
  });

  it('flags a literal RunWorkflow with the literal path as the callee', () => {
    const run = cards.find((c) => c.invokeCallee === 'Sub/Child.xaml');
    expect(run?.invokeKind).toBe('run-workflow');
  });

  it('flags a non-literal RunWorkflow as dynamic', () => {
    const dyn = cards.find(
      (c) => c.invokeKind === 'run-workflow' && c.invokeCallee === DYNAMIC_WORKFLOW_NAME
    );
    expect(dyn).toBeDefined();
  });

  it('does NOT flag an ordinary service call', () => {
    const getAsset = cards.find((c) => c.method === 'GetAsset');
    expect(getAsset).toBeDefined();
    expect(getAsset?.invokeKind).toBeUndefined();
  });
});

describe('attachInvokeTargets (host resolution from the project graph)', () => {
  function graphWith(nodes: CodedGraphNode[]): CodedProjectGraph {
    return {
      projectName: 'P',
      projectRootUri: 'file:///proj',
      nodes,
      edges: [],
      buildMs: 0,
      truncated: false
    };
  }

  let cards: CwActivityCard[];
  beforeAll(async () => {
    const model = await build(SOURCE);
    attachInvokeTargets(
      model,
      graphWith([
        // 'Foo' resolves to exactly one coded workflow with a uri.
        node('cs:Foo.cs#Foo', 'coded-workflow', 'Foo', {
          relPath: 'Foo.cs',
          uri: 'file:///proj/Foo.cs'
        }),
        // 'Baz' is declared twice → ambiguous. ('Bar' is absent → no-match.)
        node('cs:a/Baz.cs#Baz', 'coded-workflow', 'Baz', { relPath: 'a/Baz.cs', uri: 'file:///proj/a/Baz.cs' }),
        node('cs:b/Baz.cs#Baz', 'coded-workflow', 'Baz', { relPath: 'b/Baz.cs', uri: 'file:///proj/b/Baz.cs' }),
        // The literal RunWorkflow target exists. (No node for any other xaml path → missing-file.)
        node('xaml:Sub/Child.xaml', 'xaml-workflow', 'Child.xaml', {
          relPath: 'Sub/Child.xaml',
          uri: 'file:///proj/Sub/Child.xaml'
        })
      ])
    );
    cards = activities(model);
  });

  const target = (callee: string): CwActivityCard['invokeTarget'] =>
    cards.find((c) => c.invokeCallee === callee)?.invokeTarget;

  it('resolves a single coded-workflow match to its uri', () => {
    expect(target('Foo')).toEqual({
      status: 'resolved',
      uri: 'file:///proj/Foo.cs',
      relPath: 'Foo.cs'
    });
  });

  it('reports no-match when no workflow has the callee name', () => {
    expect(target('Bar')?.status).toBe('no-match');
  });

  it('reports ambiguous when several workflows share the name', () => {
    expect(target('Baz')?.status).toBe('ambiguous');
  });

  it('resolves a literal RunWorkflow path to the xaml node uri', () => {
    expect(target('Sub/Child.xaml')).toEqual({
      status: 'resolved',
      uri: 'file:///proj/Sub/Child.xaml',
      relPath: 'Sub/Child.xaml'
    });
  });

  it('reports dynamic for a non-literal RunWorkflow', () => {
    expect(target(DYNAMIC_WORKFLOW_NAME)?.status).toBe('dynamic');
  });

  it('leaves ordinary activities untouched', () => {
    const getAsset = cards.find((c) => c.method === 'GetAsset');
    expect(getAsset?.invokeTarget).toBeUndefined();
  });

  it('reports missing-file for a literal RunWorkflow with no xaml node', async () => {
    const model = await build('public class F : CodedWorkflow { [Workflow] public void E() { RunWorkflow("Gone.xaml"); } }');
    attachInvokeTargets(model, graphWith([]));
    const run = activities(model).find((c) => c.invokeCallee === 'Gone.xaml');
    expect(run?.invokeTarget?.status).toBe('missing-file');
  });
});
