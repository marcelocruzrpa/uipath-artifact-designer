/**
 * Tests for the v0 model builder (`buildModel.ts`) — the walking-skeleton
 * stub classifier that turns a parsed C# tree into a `CodedWorkflowModel`
 * with one flat tier-3 raw chip per leaf statement.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwRawChip,
  SourceSpan
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

/** Re-slice `source` by a 0-based span — verifies span↔code agreement. */
function sliceBySpan(source: string, span: SourceSpan): string {
  const lines = source.split('\n');
  if (span.startLine === span.endLine) {
    return lines[span.startLine].slice(span.startCol, span.endCol);
  }
  const parts = [lines[span.startLine].slice(span.startCol)];
  for (let i = span.startLine + 1; i < span.endLine; i += 1) {
    parts.push(lines[i]);
  }
  parts.push(lines[span.endLine].slice(0, span.endCol));
  return parts.join('\n');
}

/** 0-based line of the first source line containing `needle`. */
function lineOf(source: string, needle: string): number {
  const index = source.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`fixture is missing: ${needle}`);
  return index;
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

describe('buildModel — v0 flat body chips', () => {
  it('emits one flat raw chip per leaf, recursing through containers', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];

    // Containers (if/foreach) are recursed into but NOT emitted in v0.
    expect(execute.body.every((s) => s.type === 'raw')).toBe(true);
    const chips = execute.body as CwRawChip[];
    expect(chips.map((c) => c.code)).toEqual([
      'count = 0;',
      'Log("has name");',
      'count = count + 1;',
      'return name;'
    ]);
  });

  it('assigns stable walk-order ids <entryName>/<index>', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    expect(execute.body.map((s) => s.id)).toEqual([
      'Execute/0',
      'Execute/1',
      'Execute/2',
      'Execute/3'
    ]);
    const helper = model.classes[0].helperMethods[0];
    expect(helper.body.map((s) => s.id)).toEqual(['LogTwice/0', 'LogTwice/1']);
  });

  it('produces exact 0-based spans that slice back to the chip code', async () => {
    const model = await build(MIXED_FILE);
    const execute = model.classes[0].entryPoints[0];
    for (const stmt of execute.body) {
      const chip = stmt as CwRawChip;
      expect(sliceBySpan(MIXED_FILE, chip.span)).toBe(chip.code);
      expect(chip.lineCount).toBe(chip.span.endLine - chip.span.startLine + 1);
      expect(chip.statementCount).toBe(1);
      expect(chip.codeTruncated).toBe(false);
    }
    const logChip = execute.body[1] as CwRawChip;
    expect(logChip.span.startLine).toBe(lineOf(MIXED_FILE, 'Log("has name");'));
    expect(logChip.span.startCol).toBe(MIXED_FILE.split('\n')[logChip.span.startLine].indexOf('Log'));
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
    const summed = perMethod.reduce((sum, m) => sum + m.tierCounts.tier3, 0);
    expect(summed).toBe(model.stats.totalStatements);
    // Execute: 4 leaves, Verify: 2, LogTwice: 2 — Helper class is excluded.
    expect(model.stats.totalStatements).toBe(8);
    expect(model.stats.tier1).toBe(0);
    expect(model.stats.tier2).toBe(0);
    expect(model.stats.tier3).toBe(8);
    for (const m of perMethod) {
      expect(m.tierCounts.tier1).toBe(0);
      expect(m.tierCounts.tier2).toBe(0);
      expect(m.tierCounts.tier3).toBe(m.body.length);
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

    const body = model.classes[0].entryPoints[0].body as CwRawChip[];
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0].code).toBe('var x = 1;');
    expect(body.some((c) => c.code.includes('foo((('))).toBe(true);
  });

  it('survives a JSON round-trip unchanged', async () => {
    const model = await build(MIXED_FILE);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
