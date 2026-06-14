/**
 * Stage-B tests: buildModel's tier-1 leaf dispatch — CwActivityCard emission
 * with catalog/generic arg summaries (`classify/argExtract.ts`) and the three
 * M0 levers:
 *   L1 — lowercase `powerpoint` family id + new `java`/`python` families,
 *   L2 — tracked-handle element-access reads become `[indexer]` cards,
 *   L3 — `as`-expression unwrapping in the matcher chain.
 *
 * Fixtures: skeleton/sequence-tier1.cs, skeleton/excel-handles.cs,
 * skeleton/generic-known-service.cs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwContainer,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

let sequence: CodedWorkflowModel;
let excel: CodedWorkflowModel;
let generic: CodedWorkflowModel;

async function build(relPath: string): Promise<CodedWorkflowModel> {
  const source = loadFixture(relPath);
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: relPath.split('/').pop() ?? relPath,
      fileUri: `file:///fixtures/${relPath}`
    });
  } finally {
    tree.delete();
  }
}

beforeAll(async () => {
  configureCSharpParserFromNodeModules();
  sequence = await build('skeleton/sequence-tier1.cs');
  excel = await build('skeleton/excel-handles.cs');
  generic = await build('skeleton/generic-known-service.cs');
});

function asCard(stmt: CwStatement | undefined): CwActivityCard {
  expect(stmt?.type).toBe('activity');
  return stmt as CwActivityCard;
}

function asContainer(stmt: CwStatement | undefined): CwContainer {
  expect(stmt?.type).toBe('container');
  return stmt as CwContainer;
}

describe('tier-1 cards — straight-line sequence', () => {
  it('classifies every leaf as an activity card', () => {
    const body = sequence.classes[0].entryPoints[0].body;
    expect(body).toHaveLength(8);
    expect(body.every((s) => s.type === 'activity')).toBe(true);
    expect(sequence.classes[0].entryPoints[0].tierCounts).toEqual({
      tier1: 8,
      tier2: 0,
      tier3: 0
    });
    expect(sequence.stats.tier1).toBe(8);
    expect(sequence.stats.tier3).toBe(0);
  });

  it('renders a bare base-class Log call with a literal Message arg', () => {
    const card = asCard(sequence.classes[0].entryPoints[0].body[0]);
    expect(card.service).toBe('_base');
    expect(card.serviceDisplayName).toBe('Workflow');
    expect(card.method).toBe('Log');
    expect(card.catalogId).toBe('_base.Log');
    expect(card.title).toBe('Log');
    expect(card.icon).toBe('play-circle');
    expect(card.args).toEqual([
      {
        label: 'Message',
        value: 'starting run',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"starting run"',
        valueSpan: { start: 420, end: 434 },
        argSpan: { start: 420, end: 434 }
      }
    ]);
    expect(card.resultBinding).toBeUndefined();
  });

  it('captures result bindings and cataloged args on system calls', () => {
    const card = asCard(sequence.classes[0].entryPoints[0].body[1]);
    expect(card.service).toBe('system');
    expect(card.title).toBe('Get Asset');
    expect(card.catalogId).toBe('system.GetAsset');
    expect(card.icon).toBe('gear');
    expect(card.resultBinding).toBe('endpoint');
    expect(card.args).toEqual([
      {
        label: 'Name',
        value: 'ApiEndpoint',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"ApiEndpoint"',
        valueSpan: { start: 480, end: 493 },
        argSpan: { start: 480, end: 493 }
      }
    ]);
  });

  it('titles wildcard workflows calls from the family template with generic args', () => {
    const card = asCard(sequence.classes[0].entryPoints[0].body[4]);
    expect(card.service).toBe('workflows');
    expect(card.method).toBe('ProcessInvoice');
    expect(card.catalogId).toBeUndefined();
    expect(card.title).toBe('Invoke Workflow ProcessInvoice');
    expect(card.args).toEqual([
      {
        label: 'arg1',
        value: 'endpoint',
        kind: 'identifier',
        editableKind: 'identifier',
        valueRaw: 'endpoint',
        valueSpan: { start: 649, end: 657 },
        argSpan: { start: 649, end: 657 }
      },
      {
        label: 'arg2',
        value: '3',
        kind: 'literal',
        editableKind: 'number',
        valueRaw: '3',
        valueSpan: { start: 659, end: 660 },
        argSpan: { start: 659, end: 660 }
      }
    ]);
  });

  it('unquotes verbatim strings and keeps interpolation holes verbatim', () => {
    const run = asCard(sequence.classes[0].entryPoints[0].body[5]);
    expect(run.args[0]).toEqual({
      label: 'Workflow',
      value: 'Shared\\Notify.xaml',
      kind: 'literal',
      editableKind: 'string',
      valueRaw: '@"Shared\\Notify.xaml"',
      valueSpan: { start: 687, end: 708 },
      argSpan: { start: 687, end: 708 }
    });
    const log = asCard(sequence.classes[0].entryPoints[0].body[6]);
    expect(log.args).toEqual([
      {
        label: 'Message',
        value: 'done with {endpoint}',
        kind: 'interpolated',
        editableKind: 'raw',
        valueRaw: '$"done with {endpoint}"',
        valueSpan: { start: 734, end: 757 },
        argSpan: { start: 734, end: 757 }
      }
    ]);
  });

  it('classifies a returned service call as a card without a binding', () => {
    const card = asCard(sequence.classes[0].entryPoints[0].body[7]);
    expect(card.id).toBe('SequenceFlow#Execute/7');
    expect(card.method).toBe('GetAsset');
    expect(card.resultBinding).toBeUndefined();
  });
});

describe('tier-1 cards — excel handles', () => {
  it('builds a resource card on the using container and still tracks the handle', () => {
    const usingC = asContainer(excel.classes[0].entryPoints[0].body[0]);
    expect(usingC.kind).toBe('using');
    const resource = usingC.resourceCard;
    expect(resource).toBeDefined();
    expect(resource!.id).toBe('ExcelFlow#Execute/0.resource');
    expect(resource!.service).toBe('excel');
    expect(resource!.catalogId).toBe('excel.UseExcelFile');
    expect(resource!.title).toBe('Use Excel File');
    expect(resource!.resultBinding).toBe('wb');
    expect(resource!.args).toEqual([
      {
        label: 'File',
        value: 'invoices.xlsx',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"invoices.xlsx"',
        valueSpan: { start: 454, end: 469 },
        argSpan: { start: 454, end: 469 }
      },
      {
        label: 'Options',
        value: 'SaveChanges: true, ReadOnly: false',
        kind: 'expression',
        editableKind: 'none',
        argSpan: { start: 471, end: 534 }
      }
    ]);

    const children = usingC.slots[0].children;
    expect(children.map((s) => s.type)).toEqual(['activity', 'activity', 'activity']);
  });

  it('walks element access through to the handle method (Read Range)', () => {
    const usingC = asContainer(excel.classes[0].entryPoints[0].body[0]);
    const card = asCard(usingC.slots[0].children[0]);
    expect(card.service).toBe('excel');
    expect(card.method).toBe('ReadRange');
    expect(card.title).toBe('Read Range');
    expect(card.catalogId).toBeUndefined();
    expect(card.resultBinding).toBe('range');
  });

  it('L3: unwraps `as` expressions so the inner call still matches', () => {
    const usingC = asContainer(excel.classes[0].entryPoints[0].body[0]);
    const card = asCard(usingC.slots[0].children[1]);
    expect(card.method).toBe('ReadCell');
    expect(card.title).toBe('Read Cell');
    expect(card.resultBinding).toBe('cellValue');
    expect(card.args).toEqual([
      {
        label: 'arg1',
        value: 'sheet',
        kind: 'identifier',
        editableKind: 'identifier',
        valueRaw: 'sheet',
        valueSpan: { start: 653, end: 658 },
        argSpan: { start: 653, end: 658 }
      },
      {
        label: 'arg2',
        value: 'B7',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"B7"',
        valueSpan: { start: 660, end: 664 },
        argSpan: { start: 660, end: 664 }
      }
    ]);
  });

  it('tracks handles bound by plain declarations after the using', () => {
    const body = excel.classes[0].entryPoints[0].body;
    const report = asCard(body[1]);
    expect(report.resultBinding).toBe('report');
    const append = asCard(body[2]);
    expect(append.service).toBe('excel');
    expect(append.method).toBe('AppendRange');
    // resourceCard (1) + 3 inside using + 2 after = 6 tier-1 leaves.
    expect(excel.classes[0].entryPoints[0].tierCounts).toEqual({
      tier1: 6,
      tier2: 0,
      tier3: 0
    });
  });
});

describe('tier-1 cards — M0 levers L1/L2 + generic titles', () => {
  it('L1: lowercase powerpoint resolves; unknown members humanize their titles', () => {
    const usingC = asContainer(generic.classes[0].entryPoints[0].body[0]);
    const resource = usingC.resourceCard;
    expect(resource).toBeDefined();
    expect(resource!.service).toBe('powerpoint');
    expect(resource!.serviceDisplayName).toBe('PowerPoint');
    expect(resource!.catalogId).toBeUndefined();
    expect(resource!.title).toBe('Use Power Point Presentation');

    const slide = asCard(usingC.slots[0].children[0]);
    expect(slide.service).toBe('powerpoint');
    expect(slide.title).toBe('Add New Slide');
  });

  it('L1: java and python scope calls are cataloged tier-1 entries', () => {
    const body = generic.classes[0].entryPoints[0].body;
    const java = asCard(body[1]);
    expect(java.service).toBe('java');
    expect(java.catalogId).toBe('java.UseJavaScope');
    expect(java.title).toBe('Use Java Scope');
    expect(java.resultBinding).toBe('js');
    expect(java.args).toEqual([
      {
        label: 'Options',
        value: 'JavaPath: C:\\jdk',
        kind: 'expression',
        editableKind: 'none',
        argSpan: { start: 582, end: 629 }
      }
    ]);

    const python = asCard(body[2]);
    expect(python.service).toBe('python');
    expect(python.catalogId).toBe('python.UsePythonScope');
    expect(python.title).toBe('Use Python Scope');
  });

  it('L2: a tracked-handle indexer read becomes a Get Item card', () => {
    const body = generic.classes[0].entryPoints[0].body;
    const row = asCard(body[3]);
    expect(row.service).toBe('testing');
    expect(row.resultBinding).toBe('address');

    const item = asCard(body[4]);
    expect(item.service).toBe('testing');
    expect(item.serviceDisplayName).toBe('Testing');
    expect(item.method).toBe('[indexer]');
    expect(item.title).toBe('Get Item');
    expect(item.catalogId).toBeUndefined();
    expect(item.icon).toBe('beaker');
    expect(item.resultBinding).toBe('country');
    expect(item.args).toEqual([
      {
        label: 'Key',
        value: 'Country',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"Country"',
        valueSpan: { start: 822, end: 831 }
      }
    ]);
  });

  it('leaves unmatched by tier-1 fall through to the tier-2/tier-3 layers', () => {
    // `var compact = string.Join(",", parts);` is no tier-1 service call.
    // Since T3.2 shipped `assign-from-call` it renders as a tier-2 pseudo-step
    // (pre-T3.2 it degraded to a raw chip); raw-chip degradation itself is
    // covered by chips.test.ts ("dispatches tier1 > tier2 > chip").
    const body = generic.classes[0].entryPoints[0].body;
    const last = body[body.length - 1];
    expect(last.type).toBe('pseudo');
    expect((last as { ruleId?: string }).ruleId).toBe('assign-from-call');
  });
});
