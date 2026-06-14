/**
 * Stage-D golden-model tests: each skeleton fixture's full model is pinned
 * as a file snapshot under tests/fixtures/codedWorkflow/expected/.
 *
 * `stableJson` strips the non-deterministic stats.parseMs/classifyMs before
 * snapshotting.  Each snapshot is PAIRED with explicit load-bearing
 * assertions that `vitest -u` cannot silently bless — if a refactor changes
 * a card title, a chip lineCount, or a slot label, those fail loudly even
 * when the snapshot is regenerated.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwContainer,
  CwRawChip
} from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(name: string): Promise<CodedWorkflowModel> {
  const source = loadFixture(`skeleton/${name}.cs`);
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: `${name}.cs`,
      fileUri: `file:///fixtures/skeleton/${name}.cs`
    });
  } finally {
    tree.delete();
  }
}

/** Deterministic JSON: timing stats stripped, 2-space indent. */
function stableJson(model: CodedWorkflowModel): string {
  const { parseMs, classifyMs, ...stats } = model.stats;
  return `${JSON.stringify({ ...model, stats }, null, 2)}\n`;
}

async function snapshot(name: string): Promise<CodedWorkflowModel> {
  const model = await build(name);
  await expect(stableJson(model)).toMatchFileSnapshot(
    `../../fixtures/codedWorkflow/expected/${name}.model.json`
  );
  return model;
}

describe('golden models — skeleton fixtures', () => {
  it('containers-nesting', async () => {
    const model = await snapshot('containers-nesting');
    const body = model.classes[0].entryPoints[0].body;
    const tryC = body[4] as CwContainer;
    expect(tryC.slots.map((s) => s.label)).toEqual([
      'Try',
      'Catch IOException ex',
      'Catch',
      'Finally'
    ]);
    const forC = body[2] as CwContainer;
    expect(forC.header).toBe('For var i = 0; i < mode; i++');
    // 20 leaves in Execute + 1 in each helper — all tier-3 by design.
    expect(model.stats).toMatchObject({ tier1: 0, tier2: 0, tier3: 22 });
  });

  it('sequence-tier1', async () => {
    const model = await snapshot('sequence-tier1');
    const card = model.classes[0].entryPoints[0].body[1] as CwActivityCard;
    expect(card.title).toBe('Get Asset');
    expect(card.args).toEqual([
      {
        label: 'Name',
        value: 'ApiEndpoint',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"ApiEndpoint"',
        valueSpan: { start: 480, end: 493 }
      }
    ]);
    expect(model.stats).toMatchObject({ tier1: 8, tier3: 0 });
  });

  it('excel-handles', async () => {
    const model = await snapshot('excel-handles');
    const usingC = model.classes[0].entryPoints[0].body[0] as CwContainer;
    expect(usingC.resourceCard?.args[1]).toEqual({
      label: 'Options',
      value: 'SaveChanges: true, ReadOnly: false',
      kind: 'expression',
      editableKind: 'none'
    });
    expect((usingC.slots[0].children[1] as CwActivityCard).title).toBe('Read Cell');
  });

  it('generic-known-service', async () => {
    const model = await snapshot('generic-known-service');
    const body = model.classes[0].entryPoints[0].body;
    const indexer = body[4] as CwActivityCard;
    expect(indexer.title).toBe('Get Item');
    expect(indexer.args).toEqual([
      {
        label: 'Key',
        value: 'Country',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"Country"',
        valueSpan: { start: 822, end: 831 }
      }
    ]);
    expect((body[1] as CwActivityCard).catalogId).toBe('java.UseJavaScope');
  });

  it('chips-merge', async () => {
    const model = await snapshot('chips-merge');
    const merged = model.classes[0].entryPoints[0].body[0] as CwRawChip;
    expect(merged.statementCount).toBe(3);
    expect(merged.lineCount).toBe(5);
    const big = model.classes[0].entryPoints[1].body[0] as CwRawChip;
    expect(big.lineCount).toBe(50);
    expect(big.codeTruncated).toBe(true);
  });

  it('broken-syntax', async () => {
    const model = await snapshot('broken-syntax');
    expect(model.parseHealth).toBe('partial');
    expect(model.classes[0].entryPoints.map((e) => e.name)).toEqual(['Execute', 'Healthy']);
  });
});
