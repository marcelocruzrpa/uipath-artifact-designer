/**
 * Tests for the model builder (`buildModel.ts`) — class/entry discovery,
 * container-aware body classification, stats, and health.  Container shapes
 * have their own deep suite in `containers.test.ts`; here the MIXED_FILE
 * checks cover the structural contract on a small realistic file.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  configureCSharpParserFromNodeModules,
  loadFixture,
  sliceBySpan,
  lineOf
} from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import { findNodeById } from '../../../src/model/codedWorkflow/edit/findNode';
import type {
  CodedWorkflowModel,
  CwContainer,
  CwPseudoStep,
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

describe('duplicate class names in one document get unique ids', () => {
  const DUP = [
    'namespace A { public class W : CodedWorkflow { [Workflow] public void Execute() { LogA(); } } }',
    'namespace B { public class W : CodedWorkflow { [Workflow] public void Execute() { LogB(); } } }'
  ].join('\n');

  it('suffixes the 2nd same-named class so statement ids do not collide', async () => {
    const model = await build(DUP);
    expect(model.classes).toHaveLength(2);
    expect(model.classes[0].className).toBe('W');
    expect(model.classes[1].className).toBe('W'); // display name unchanged
    const id0 = model.classes[0].entryPoints[0].bodyId;
    const id1 = model.classes[1].entryPoints[0].bodyId;
    expect(id0).toBe('W#Execute/');
    expect(id1).toBe('W@2#Execute/');
    expect(id0).not.toBe(id1);
  });

  it('findNodeById resolves each card to the correct class (no first-match collision)', async () => {
    const model = await build(DUP);
    const s0 = model.classes[0].entryPoints[0].body[0];
    const s1 = model.classes[1].entryPoints[0].body[0];
    expect(s0.id).not.toBe(s1.id);
    // Each id round-trips to ITS OWN statement, not the first same-id match.
    expect(findNodeById(model, s0.id)).toBe(s0);
    expect(findNodeById(model, s1.id)).toBe(s1);
    // ...and the two statements are at different source offsets (LogA vs LogB).
    expect(s0.offsets?.start).not.toBe(s1.offsets?.start);
  });
});

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

/** Collect every node id in a statement tree, depth-first (incl. resource cards). */
function collectIds(children: CwStatement[]): string[] {
  const out: string[] = [];
  for (const child of children) {
    out.push(child.id);
    if (child.type === 'container') {
      if (child.resourceCard !== undefined) out.push(child.resourceCard.id);
      for (const slot of child.slots) out.push(...collectIds(slot.children));
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

  it('returns the empty state for helper-only files (classes [], names listed)', async () => {
    const model = await build(loadFixture('detection/helper-class.cs'), 'helper-class.cs');
    expect(model.classes).toEqual([]);
    expect(model.otherClassNames).toEqual(['StringHelpers']);
    expect(model.parseHealth).toBe('ok');
    expect(model.stats.totalStatements).toBe(0);
  });

  it('returns the empty state for an empty file', async () => {
    const model = await build(loadFixture('detection/empty.cs'), 'empty.cs');
    expect(model.classes).toEqual([]);
    expect(model.otherClassNames).toEqual([]);
    expect(model.parseHealth).toBe('ok');
  });

  it('builds the attribute-only partial fixture as a workflow class', async () => {
    const model = await build(
      loadFixture('detection/workflow-attribute-only.cs'),
      'workflow-attribute-only.cs'
    );
    expect(model.classes.map((c) => c.className)).toEqual(['PartialFlow']);
    expect(model.classes[0].baseType).toBe('CodedWorkflow');
    expect(model.otherClassNames).toEqual([]);
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

    // `count = 0;` is a single-literal assign → a tier-2 assign-literal card
    // since the data-driven rules shipped; `return name;` stays a tier-3 chip.
    expect(execute.body.map((s) => s.type)).toEqual(['pseudo', 'container', 'raw']);
    expect((execute.body[0] as CwPseudoStep).ruleId).toBe('assign-literal');
    expect((execute.body[0] as CwPseudoStep).text).toBe('count = 0');
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
    // `count = count + 1;` is an arithmetic reassignment → a generic Assign card
    // (verbatim RHS) since the assign-generic floor rule shipped.
    expect((foreach.slots[0].children[0] as CwPseudoStep).ruleId).toBe('assign-generic');
    expect((foreach.slots[0].children[0] as CwPseudoStep).text).toBe('count = count + 1');
  });

  it('assigns hierarchical stable ids <className>#<methodName>/<path>', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    expect(execute.body.map((s) => s.id)).toEqual([
      'InvoiceFlow#Execute/0',
      'InvoiceFlow#Execute/1',
      'InvoiceFlow#Execute/2'
    ]);

    const ifC = execute.body[1] as CwContainer;
    expect(ifC.slots[0].children.map((s) => s.id)).toEqual([
      'InvoiceFlow#Execute/1.then.0',
      'InvoiceFlow#Execute/1.then.1'
    ]);
    const foreach = ifC.slots[0].children[1] as CwContainer;
    expect(foreach.slots[0].children.map((s) => s.id)).toEqual([
      'InvoiceFlow#Execute/1.then.1.body.0'
    ]);

    const helper = model.classes[0].helperMethods[0];
    expect(helper.body.map((s) => s.id)).toEqual([
      'InvoiceFlow#LogTwice/0',
      'InvoiceFlow#LogTwice/1'
    ]);
  });

  it('keeps statement ids unique across classes sharing a method name', async () => {
    const source = [
      'namespace Acme',
      '{',
      '    public class FirstFlow : CodedWorkflow',
      '    {',
      '        [Workflow]',
      '        public void Execute()',
      '        {',
      '            var a = 1;',
      '            if (a > 0)',
      '            {',
      '                Log("first");',
      '            }',
      '        }',
      '    }',
      '',
      '    public class SecondFlow : CodedWorkflow',
      '    {',
      '        [Workflow]',
      '        public void Execute()',
      '        {',
      '            var b = 2;',
      '            if (b > 0)',
      '            {',
      '                Log("second");',
      '            }',
      '        }',
      '    }',
      '}',
      ''
    ].join('\n');
    const model = await build(source);
    expect(model.classes.map((c) => c.className)).toEqual(['FirstFlow', 'SecondFlow']);

    expect(model.classes[0].entryPoints[0].body.map((s) => s.id)).toEqual([
      'FirstFlow#Execute/0',
      'FirstFlow#Execute/1'
    ]);
    expect(model.classes[1].entryPoints[0].body.map((s) => s.id)).toEqual([
      'SecondFlow#Execute/0',
      'SecondFlow#Execute/1'
    ]);

    const allIds = model.classes.flatMap((cls) =>
      [...cls.entryPoints, ...cls.helperMethods].flatMap((m) => collectIds(m.body))
    );
    expect(allIds.length).toBeGreaterThan(0);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('disambiguates method overloads with an ordinal on the 2nd+ occurrence', async () => {
    const source = [
      'public class Invoices : CodedWorkflow',
      '{',
      '    [Workflow]',
      '    public void Run()',
      '    {',
      '        Log("no args");',
      '    }',
      '',
      '    public void Run(int count)',
      '    {',
      '        Log("with count");',
      '    }',
      '}',
      ''
    ].join('\n');
    const model = await build(source);
    const cls = model.classes[0];

    expect(cls.entryPoints[0].body.map((s) => s.id)).toEqual(['Invoices#Run/0']);
    expect(cls.helperMethods[0].body.map((s) => s.id)).toEqual(['Invoices#Run@2/0']);

    const allIds = [...cls.entryPoints, ...cls.helperMethods].flatMap((m) =>
      collectIds(m.body)
    );
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('produces exact 0-based spans that slice back to the chip code', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    const chips = collectChips(execute.body);
    // `return name;` is the only tier-3 chip: Log is a tier-1 card, `count = 0;`
    // is a tier-2 assign-literal card, and `count = count + 1;` is a tier-2
    // assign-generic card.
    expect(chips.length).toBe(1);
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
    // calls are tier-1 cards; the two single-literal assigns (`count = 0;`,
    // `var expected = 3;`) are tier-2 assign-literal cards and the arithmetic
    // `count = count + 1;` is a tier-2 assign-generic card; only `return name;`
    // stays a tier-3 chip.
    expect(model.stats.totalStatements).toBe(8);
    expect(model.stats.tier1).toBe(4);
    expect(model.stats.tier2).toBe(3);
    expect(model.stats.tier3).toBe(1);
    for (const m of perMethod) {
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
      '        Bar();',
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
    // therefore merge into ONE chip carrying both raw texts (Stage C). A bare
    // call (`Bar();`) is used as the clean statement so it stays a tier-3 chip
    // and merges, rather than being lifted to a tier-2 Assign card.
    const body = model.classes[0].entryPoints[0].body as CwRawChip[];
    expect(body).toHaveLength(1);
    // Exactly how many nodes tree-sitter recovers from the broken region is
    // grammar-version detail — at least the clean statement plus one.
    expect(body[0].statementCount).toBeGreaterThanOrEqual(2);
    expect(body[0].code.startsWith('Bar();')).toBe(true);
    expect(body[0].code).toContain('foo(((');
  });

  it('survives a JSON round-trip unchanged', async () => {
    const model = await build(MIXED_FILE);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
