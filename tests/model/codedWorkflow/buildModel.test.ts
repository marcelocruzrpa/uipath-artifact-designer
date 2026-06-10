/**
 * Tests for the model builder (`buildModel.ts`) — class/entry discovery,
 * container-aware body classification, stats, and health.  Container shapes
 * have their own deep suite in `containers.test.ts`; here the MIXED_FILE
 * checks cover the structural contract on a small realistic file.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, sliceBySpan, lineOf } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwContainer,
  CwRawChip,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(source: string, fileName = 'Flow.cs'): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName,
      fileUri: `file:///workspace/${fileName}`
    });
  } finally {
    tree.delete();
  }
}

/** Collect every raw chip in a statement tree, depth-first. */
function collectChips(children: CwStatement[]): CwRawChip[] {
  const out: CwRawChip[] = [];
  for (const child of children) {
    if (child.type === 'raw') out.push(child);
    if (child.type === 'container') {
      for (const slot of child.slots) out.push(...collectChips(slot.children));
    }
  }
  return out;
}

const MIXED_FILE = `namespace Acme.Flows
{
    public class InvoiceFlow : CodedWorkflow
    {
        [Workflow]
        public string Execute(in string name, out int count)
        {
            count = 0;
            if (name.Length > 0)
            {
                Log("has name");
                foreach (var c in name)
                {
                    count = count + 1;
                }
            }
            return name;
        }

        [TestCase]
        public void Verify()
        {
            var expected = 3;
            Log("checking");
        }

        private void LogTwice(string message)
        {
            Log(message);
            Log(message);
        }
    }

    public class Helper
    {
        public void Assist()
        {
            var x = 1;
        }
    }
}
`;

describe('buildModel — structure', () => {
  it('finds the workflow class with namespace, base type, and span', async () => {
    const model = await build(MIXED_FILE);
    expect(model.kind).toBe('coded-workflow');
    expect(model.fileName).toBe('Flow.cs');
    expect(model.fileUri).toBe('file:///workspace/Flow.cs');
    expect(model.classes).toHaveLength(1);

    const cls = model.classes[0];
    expect(cls.className).toBe('InvoiceFlow');
    expect(cls.namespace).toBe('Acme.Flows');
    expect(cls.baseType).toBe('CodedWorkflow');
    expect(cls.span.startLine).toBe(lineOf(MIXED_FILE, 'public class InvoiceFlow'));
  });

  it('lists non-workflow classes in otherClassNames', async () => {
    const model = await build(MIXED_FILE);
    expect(model.otherClassNames).toEqual(['Helper']);
  });

  it('splits entry points from helper methods with the right attributes', async () => {
    const model = await build(MIXED_FILE);
    const cls = model.classes[0];

    expect(cls.entryPoints.map((e) => e.name)).toEqual(['Execute', 'Verify']);
    expect(cls.entryPoints[0].attribute).toBe('Workflow');
    expect(cls.entryPoints[1].attribute).toBe('TestCase');
    expect(cls.helperMethods.map((h) => h.name)).toEqual(['LogTwice']);
  });

  it('summarizes signatures with parameter modifiers and non-void returns', async () => {
    const model = await build(MIXED_FILE);
    const [execute, verify] = model.classes[0].entryPoints;
    expect(execute.signatureSummary).toBe('in string name, out int count → string');
    expect(verify.signatureSummary).toBe('');
  });

  it('reads the namespace from a file-scoped namespace declaration', async () => {
    const source = [
      'namespace Scoped.Flows;',
      '',
      'public class F : CodedWorkflow',
      '{',
      '    [Workflow]',
      '    public void Run() { Log("hi"); }',
      '}',
      ''
    ].join('\n');
    const model = await build(source);
    expect(model.classes).toHaveLength(1);
    expect(model.classes[0].namespace).toBe('Scoped.Flows');
  });

  it('treats an attribute-only class (no base list) as a workflow class', async () => {
    const source = [
      'public partial class P',
      '{',
      '    [Workflow]',
      '    public void Run() { Log("hi"); }',
      '}',
      ''
    ].join('\n');
    const model = await build(source);
    expect(model.classes).toHaveLength(1);
    expect(model.classes[0].className).toBe('P');
    // Documented fallback when there is no base list at all.
    expect(model.classes[0].baseType).toBe('CodedWorkflow');
    expect(model.otherClassNames).toEqual([]);
  });
});

describe('buildModel — container-aware body', () => {
  it('emits chips for leaves and containers for control flow', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];

    expect(execute.body.map((s) => s.type)).toEqual(['raw', 'container', 'raw']);
    expect((execute.body[0] as CwRawChip).code).toBe('count = 0;');
    expect((execute.body[2] as CwRawChip).code).toBe('return name;');

    const ifC = execute.body[1] as CwContainer;
    expect(ifC.kind).toBe('if');
    expect(ifC.header).toBe('If name.Length > 0');
    expect(ifC.slots.map((s) => s.role)).toEqual(['then']);

    const then = ifC.slots[0];
    // Log(...) is a tier-1 base-class call → an activity card since Stage B.
    expect(then.children.map((s) => s.type)).toEqual(['activity', 'container']);
    const foreach = then.children[1] as CwContainer;
    expect(foreach.kind).toBe('foreach');
    expect(foreach.header).toBe('For Each c in name');
    expect((foreach.slots[0].children[0] as CwRawChip).code).toBe('count = count + 1;');
  });

  it('assigns hierarchical stable ids <entryName>/<path>', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    expect(execute.body.map((s) => s.id)).toEqual(['Execute/0', 'Execute/1', 'Execute/2']);

    const ifC = execute.body[1] as CwContainer;
    expect(ifC.slots[0].children.map((s) => s.id)).toEqual([
      'Execute/1.then.0',
      'Execute/1.then.1'
    ]);
    const foreach = ifC.slots[0].children[1] as CwContainer;
    expect(foreach.slots[0].children.map((s) => s.id)).toEqual(['Execute/1.then.1.body.0']);

    const helper = model.classes[0].helperMethods[0];
    expect(helper.body.map((s) => s.id)).toEqual(['LogTwice/0', 'LogTwice/1']);
  });

  it('produces exact 0-based spans that slice back to the chip code', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    const chips = collectChips(execute.body);
    // count = 0; / count = count + 1; / return name; — Log is a card now.
    expect(chips.length).toBe(3);
    for (const chip of chips) {
      expect(sliceBySpan(MIXED_FILE, chip.span)).toBe(chip.code);
      expect(chip.lineCount).toBe(chip.span.endLine - chip.span.startLine + 1);
      expect(chip.statementCount).toBe(1);
      expect(chip.codeTruncated).toBe(false);
    }
    const ifC = execute.body[1] as CwContainer;
    const logCard = ifC.slots[0].children[0];
    expect(logCard.type).toBe('activity');
    expect(logCard.span.startLine).toBe(lineOf(MIXED_FILE, 'Log("has name");'));
    expect(logCard.span.startCol).toBe(MIXED_FILE.split('\n')[logCard.span.startLine].indexOf('Log'));
  });
});

describe('buildModel — stats and health', () => {
  it('adds up: totalStatements === tier3 and per-method counts sum to stats', async () => {
    const model = await build(MIXED_FILE);
    const cls = model.classes[0];

    expect(model.parseHealth).toBe('ok');
    expect(model.parseErrorCount).toBe(0);
    expect(model.diagnostics).toEqual([]);
    expect(model.truncated).toBe(false);
    expect(model.totalLines).toBe(MIXED_FILE.split('\n').length);

    const perMethod = [...cls.entryPoints, ...cls.helperMethods];
    const summed = perMethod.reduce(
      (sum, m) => sum + m.tierCounts.tier1 + m.tierCounts.tier2 + m.tierCounts.tier3,
      0
    );
    expect(summed).toBe(model.stats.totalStatements);
    // Execute: 4 leaves, Verify: 2, LogTwice: 2 — Helper class is excluded;
    // containers do not count, only the leaves inside them.  The four Log
    // calls are tier-1 cards; the other four leaves stay tier-3 chips.
    expect(model.stats.totalStatements).toBe(8);
    expect(model.stats.tier1).toBe(4);
    expect(model.stats.tier2).toBe(0);
    expect(model.stats.tier3).toBe(4);
    for (const m of perMethod) {
      expect(m.tierCounts.tier2).toBe(0);
      const chipStatements = collectChips(m.body).reduce((s, c) => s + c.statementCount, 0);
      expect(m.tierCounts.tier3).toBe(chipStatements);
    }
    expect(model.stats.parseMs).toBeGreaterThanOrEqual(0);
    expect(model.stats.classifyMs).toBeGreaterThanOrEqual(0);
  });

  it('marks broken source as partial but still emits chips with the raw text', async () => {
    const source = [
      'class W : CodedWorkflow',
      '{',
      '    [Workflow]',
      '    void E()',
      '    {',
      '        var x = 1;',
      '        foo(((  ;',
      '    }',
      '}',
      ''
    ].join('\n');
    const model = await build(source);

    expect(model.parseHealth).toBe('partial');
    expect(model.parseErrorCount).toBeGreaterThan(0);
    expect(model.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Some statements could not be parsed and are shown as raw code.'
      }
    ]);

    // The recovered statement and the broken region are adjacent chips and
    // therefore merge into ONE chip carrying both raw texts (Stage C).
    const body = model.classes[0].entryPoints[0].body as CwRawChip[];
    expect(body).toHaveLength(1);
    // Exactly how many nodes tree-sitter recovers from the broken region is
    // grammar-version detail — at least the clean statement plus one.
    expect(body[0].statementCount).toBeGreaterThanOrEqual(2);
    expect(body[0].code.startsWith('var x = 1;')).toBe(true);
    expect(body[0].code).toContain('foo(((');
  });

  it('survives a JSON round-trip unchanged', async () => {
    const model = await build(MIXED_FILE);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
