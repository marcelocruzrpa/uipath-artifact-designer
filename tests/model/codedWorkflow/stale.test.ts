/**
 * Tests for the keep-last-good staleness policy (`stale.ts`) — the R8 rule
 * that decides whether a freshly parsed model is renderable or whether the
 * last clean model should be shown as 'stale' instead.
 */
import { describe, it, expect } from 'vitest';
import { resolveRenderable } from '../../../src/model/codedWorkflow/stale';
import type {
  CodedWorkflowModel,
  CwWorkflowClass
} from '../../../src/model/codedWorkflow/cwTypes';

function workflowClass(className: string): CwWorkflowClass {
  return {
    className,
    baseType: 'CodedWorkflow',
    span: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    entryPoints: [],
    helperMethods: []
  };
}

function model(overrides: Partial<CodedWorkflowModel> = {}): CodedWorkflowModel {
  return {
    kind: 'coded-workflow',
    title: 'Flow.cs',
    subtitle: 'Coded Workflow',
    diagnostics: [],
    fileName: 'Flow.cs',
    fileUri: 'file:///workspace/Flow.cs',
    classes: [workflowClass('Flow')],
    otherClassNames: [],
    parseHealth: 'ok',
    parseErrorCount: 0,
    truncated: false,
    totalLines: 10,
    stats: { totalStatements: 10, tier1: 0, tier2: 0, tier3: 10, parseMs: 1, classifyMs: 1 },
    ...overrides
  };
}

function partial(overrides: Partial<CodedWorkflowModel> = {}): CodedWorkflowModel {
  return model({ parseHealth: 'partial', parseErrorCount: 3, ...overrides });
}

function withStatements(m: CodedWorkflowModel, totalStatements: number): CodedWorkflowModel {
  return { ...m, stats: { ...m.stats, totalStatements, tier3: totalStatements } };
}

describe('resolveRenderable', () => {
  it('returns fresh when the parse is clean, even with a lastGood available', () => {
    const fresh = model();
    const lastGood = model({ title: 'old' });
    expect(resolveRenderable(fresh, lastGood)).toBe(fresh);
  });

  it('returns a clean-but-empty fresh as-is when it parsed without errors', () => {
    const fresh = model({ classes: [], otherClassNames: ['Helper'] });
    const lastGood = model();
    expect(resolveRenderable(fresh, lastGood)).toBe(fresh);
  });

  it('falls back to stale lastGood when a broken parse lost every class', () => {
    const fresh = partial({ classes: [] });
    const lastGood = model();
    const result = resolveRenderable(fresh, lastGood);
    expect(result.parseHealth).toBe('stale');
    expect(result.classes).toEqual(lastGood.classes);
    expect(result.stats).toEqual(lastGood.stats);
  });

  it('falls back to stale lastGood when statements collapse below 50%', () => {
    const fresh = withStatements(partial(), 4); // ceil(10 * 0.5) = 5 → 4 < 5
    const lastGood = model();
    const result = resolveRenderable(fresh, lastGood);
    expect(result.parseHealth).toBe('stale');
    expect(result.stats.totalStatements).toBe(10);
  });

  it('keeps a partial-but-substantial fresh model (>= 50% of lastGood)', () => {
    const fresh = withStatements(partial(), 5); // exactly ceil(10 * 0.5) — not below
    const lastGood = model();
    expect(resolveRenderable(fresh, lastGood)).toBe(fresh);
    expect(fresh.parseHealth).toBe('partial');
  });

  it('returns fresh when there is no lastGood, however broken it is', () => {
    const fresh = withStatements(partial({ classes: [] }), 0);
    expect(resolveRenderable(fresh, undefined)).toBe(fresh);
  });

  it('preserves lastGood.staleReason untouched and never sets one itself', () => {
    const fresh = partial({ classes: [] });
    const lastGood = model({ staleReason: 'tree-sitter init failed earlier' });
    const result = resolveRenderable(fresh, lastGood);
    expect(result.parseHealth).toBe('stale');
    expect(result.staleReason).toBe('tree-sitter init failed earlier');

    const clean = model();
    expect(resolveRenderable(clean, lastGood).staleReason).toBeUndefined();

    const staleFromPlain = resolveRenderable(partial({ classes: [] }), model());
    expect(staleFromPlain.staleReason).toBeUndefined();
  });

  it('does not mutate fresh or lastGood', () => {
    const fresh = partial({ classes: [] });
    const lastGood = model();
    const freshSnapshot = JSON.parse(JSON.stringify(fresh));
    const lastGoodSnapshot = JSON.parse(JSON.stringify(lastGood));
    resolveRenderable(fresh, lastGood);
    expect(fresh).toEqual(freshSnapshot);
    expect(lastGood).toEqual(lastGoodSnapshot);
  });
});
