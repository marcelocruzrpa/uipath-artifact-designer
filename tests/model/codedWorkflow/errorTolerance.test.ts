/**
 * Stage-D tests: R8 error tolerance end-to-end — a broken-syntax fixture
 * still renders its recovered statements as cards/chips with parseHealth
 * 'partial', and `resolveRenderable` integrates with buildModel output
 * (keep-last-good vs render-partial decisions).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import { resolveRenderable } from '../../../src/model/codedWorkflow/stale';
import type { CodedWorkflowModel } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(source: string, fileName = 'broken.cs'): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName,
      fileUri: `file:///fixtures/${fileName}`
    });
  } finally {
    tree.delete();
  }
}

describe('error tolerance — broken-syntax fixture', () => {
  it('marks the model partial but keeps recovered statements classified', async () => {
    const source = loadFixture('skeleton/broken-syntax.cs');
    const model = await build(source);

    expect(model.parseHealth).toBe('partial');
    expect(model.parseErrorCount).toBeGreaterThan(0);
    expect(model.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Some statements could not be parsed and are shown as raw code.'
      }
    ]);

    // The damaged Execute still renders: tier-1 cards BEFORE the damage and
    // raw chip(s) carrying the broken source.
    const cls = model.classes[0];
    const execute = cls.entryPoints.find((e) => e.name === 'Execute')!;
    expect(execute.body.length).toBeGreaterThanOrEqual(2);
    expect(execute.body[0].type).toBe('activity');
    expect(execute.body[1].type).toBe('activity');
    const flat = JSON.stringify(execute.body);
    expect(flat).toContain('count = = 1;');

    // The sibling method parses cleanly and classifies normally.
    const healthy = cls.entryPoints.find((e) => e.name === 'Healthy')!;
    expect(healthy.body.map((s) => s.type)).toEqual(['activity']);
    expect(healthy.tierCounts.tier1).toBe(1);
  });
});

describe('error tolerance — resolveRenderable integration', () => {
  it('keeps the last-good model when a fresh parse collapses catastrophically', async () => {
    const lastGood = await build(loadFixture('skeleton/sequence-tier1.cs'), 'seq.cs');
    expect(lastGood.parseHealth).toBe('ok');

    // Mid-edit wreckage: the class header is destroyed, everything is lost.
    const fresh = await build('public clas { { { Log("x");', 'seq.cs');
    expect(fresh.parseErrorCount).toBeGreaterThan(0);

    const renderable = resolveRenderable(fresh, lastGood);
    expect(renderable.parseHealth).toBe('stale');
    expect(renderable.classes).toEqual(lastGood.classes);
  });

  it('renders a broken-but-substantial fresh parse as partial', async () => {
    const source = loadFixture('skeleton/broken-syntax.cs');
    const lastGood = await build(source.replace('count = = 1;', 'count = 1;'));
    expect(lastGood.parseHealth).toBe('ok');

    const fresh = await build(source);
    const renderable = resolveRenderable(fresh, lastGood);
    expect(renderable).toBe(fresh);
    expect(renderable.parseHealth).toBe('partial');
  });
});
