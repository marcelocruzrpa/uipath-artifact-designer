/**
 * T2.1 — call-graph fact extraction over REAL parsed C# (no mocked trees).
 * Covers the three extraction patterns (workflows.*, RunWorkflow*, trivially
 * static helper calls), declaration facts, owner attribution, and error
 * tolerance (broken files still yield surviving facts).
 */
import { describe, expect, it } from 'vitest';
import { configureCSharpParserFromNodeModules, lineOf } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import {
  DYNAMIC_WORKFLOW_NAME,
  extractFileFacts,
  type FileFacts
} from '../../../src/model/codedWorkflow/graph/graphFacts';

/** Parse a full C# source file and extract its facts. */
async function facts(source: string, relPath = 'Workflows/Test.cs'): Promise<FileFacts> {
  configureCSharpParserFromNodeModules();
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return extractFileFacts(relPath, source, tree);
  } finally {
    tree.delete();
  }
}

/** Wrap statements in a minimal workflow class. */
function wrap(body: string): string {
  return `class W : CodedWorkflow { [Workflow] public void Execute() { ${body} } }`;
}

describe('extractFileFacts — invocation patterns', () => {
  it('captures workflows.Foo(args) as a workflows-member fact', async () => {
    const f = await facts(wrap('workflows.ValidateInvoice(id, total);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'workflows-member',
        calleeName: 'ValidateInvoice',
        ownerClassName: 'W'
      })
    ]);
  });

  it('captures this.workflows.Foo(...) as a workflows-member fact', async () => {
    const f = await facts(wrap('this.workflows.Archive(path);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({ kind: 'workflows-member', calleeName: 'Archive' })
    ]);
  });

  it('captures RunWorkflow with a string literal — calleeName is the literal value', async () => {
    const f = await facts(wrap('RunWorkflow("Legacy/Old.xaml", args);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'run-workflow',
        calleeName: 'Legacy/Old.xaml',
        isLiteralArg: true
      })
    ]);
  });

  it('decodes escape sequences in RunWorkflow literals (backslash paths)', async () => {
    const f = await facts(wrap('RunWorkflow("Legacy\\\\Old.xaml");'));
    expect(f.invocations[0].calleeName).toBe('Legacy\\Old.xaml');
    expect(f.invocations[0].isLiteralArg).toBe(true);
  });

  it('captures RunWorkflowAsync literals too', async () => {
    const f = await facts(wrap('await RunWorkflowAsync("Sub/Child.xaml");'));
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'run-workflow',
        calleeName: 'Sub/Child.xaml',
        isLiteralArg: true
      })
    ]);
  });

  it('captures member-form someObj.RunWorkflow(...) as run-workflow', async () => {
    const f = await facts(wrap('engine.RunWorkflow("X.xaml");'));
    expect(f.invocations).toEqual([
      expect.objectContaining({ kind: 'run-workflow', calleeName: 'X.xaml', isLiteralArg: true })
    ]);
  });

  it('marks RunWorkflow with a variable argument as <dynamic workflow>', async () => {
    const f = await facts(wrap('RunWorkflow(pathVar);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'run-workflow',
        calleeName: DYNAMIC_WORKFLOW_NAME,
        isLiteralArg: false
      })
    ]);
  });

  it('marks RunWorkflow with an interpolated string as dynamic', async () => {
    const f = await facts(wrap('RunWorkflow($"Legacy/{name}.xaml");'));
    expect(f.invocations[0].isLiteralArg).toBe(false);
    expect(f.invocations[0].calleeName).toBe(DYNAMIC_WORKFLOW_NAME);
  });

  it('captures new ClassName(...).Method(...) as a helper-call', async () => {
    const f = await facts(wrap('var x = new MathHelper().Calc(2, 3);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({ kind: 'helper-call', calleeName: 'MathHelper' })
    ]);
  });

  it('captures ClassName.Static(...) as a helper-call', async () => {
    const f = await facts(wrap('InvoiceHelpers.NormalizeInvoiceName(path);'));
    expect(f.invocations).toEqual([
      expect.objectContaining({ kind: 'helper-call', calleeName: 'InvoiceHelpers' })
    ]);
  });

  it('does NOT capture lowercase-receiver calls (service handles, locals)', async () => {
    const f = await facts(wrap('system.GetAsset("Key"); item.Process(); Log("hi");'));
    expect(f.invocations).toEqual([]);
  });

  it('records the 0-based start line of each invocation', async () => {
    const source = [
      'class W : CodedWorkflow {',
      '    [Workflow] public void Execute() {',
      '        workflows.Step1();',
      '        RunWorkflow("A.xaml");',
      '    }',
      '}'
    ].join('\n');
    const f = await facts(source);
    expect(f.invocations[0].line).toBe(lineOf(source, 'workflows.Step1'));
    expect(f.invocations[1].line).toBe(lineOf(source, 'RunWorkflow'));
  });

  it('attributes ownerClassName per enclosing class across multiple classes', async () => {
    const source = `
class A : CodedWorkflow { [Workflow] public void Execute() { workflows.FromA(); } }
class B : CodedWorkflow { [Workflow] public void Execute() { workflows.FromB(); } }
`;
    const f = await facts(source);
    expect(f.invocations).toEqual([
      expect.objectContaining({ calleeName: 'FromA', ownerClassName: 'A' }),
      expect.objectContaining({ calleeName: 'FromB', ownerClassName: 'B' })
    ]);
  });

  it('captures nested invocations independently', async () => {
    const f = await facts(wrap('workflows.Outer(workflows.Inner());'));
    const callees = f.invocations.map((i) => i.calleeName).sort();
    expect(callees).toEqual(['Inner', 'Outer']);
  });
});

describe('extractFileFacts — declarations', () => {
  it('flags CodedWorkflow subclasses and lists public methods', async () => {
    const source = `
class Flow : CodedWorkflow {
    [Workflow] public void Execute() { }
    public int Helper(int x) { return x; }
    private void Hidden() { }
}
class Plain { public void M() { } }
`;
    const f = await facts(source);
    expect(f.decls).toEqual([
      {
        className: 'Flow',
        isCodedWorkflow: true,
        workflowMethods: ['Execute', 'Helper'],
        hasWorkflowAttribute: true
      },
      {
        className: 'Plain',
        isCodedWorkflow: false,
        workflowMethods: ['M'],
        hasWorkflowAttribute: false
      }
    ]);
  });

  it('treats attribute-only classes (partial, base list elsewhere) as coded workflows', async () => {
    const f = await facts('partial class P { [Workflow] public void Run() { } }');
    expect(f.decls).toEqual([
      {
        className: 'P',
        isCodedWorkflow: true,
        workflowMethods: ['Run'],
        hasWorkflowAttribute: true
      }
    ]);
  });
});

describe('extractFileFacts — error tolerance', () => {
  it('sets parseHadErrors and keeps surviving facts on broken files', async () => {
    const source = `
class W : CodedWorkflow {
    [Workflow] public void Execute() {
        workflows.Survivor();
        var x = ;
    }
}
`;
    const f = await facts(source);
    expect(f.parseHadErrors).toBe(true);
    expect(f.decls.map((d) => d.className)).toContain('W');
    expect(f.invocations).toEqual([
      expect.objectContaining({ kind: 'workflows-member', calleeName: 'Survivor' })
    ]);
  });

  it('reports parseHadErrors false on clean files', async () => {
    const f = await facts(wrap('workflows.Fine();'));
    expect(f.parseHadErrors).toBe(false);
  });
});
