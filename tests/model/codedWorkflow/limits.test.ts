/**
 * Stage-D tests: scale guardrails (`limits.ts` + the collapse/truncation
 * passes in buildModel).
 *
 * ACCOUNTING RULE under test: `stats`/`tierCounts` always reflect the
 * PRE-truncation classification, and the terminal fold chip's
 * `statementCount` carries the folded remainder — so the rendered tree's
 * leaf counts always sum back to `stats.totalStatements`; nothing is
 * silently dropped.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel, nowMs } from '../../../src/model/codedWorkflow/buildModel';
import {
  COLLAPSE_STATEMENT_THRESHOLD,
  COLLAPSE_ALL_STATEMENTS,
  COLLAPSE_TOTAL_LINES,
  COLLAPSE_CONTAINER_LINES,
  MAX_RENDER_STATEMENTS,
  CHIP_CODE_MAX_LINES,
  HEADER_MAX_CHARS
} from '../../../src/model/codedWorkflow/limits';
import type {
  CodedWorkflowModel,
  CwContainer,
  CwRawChip,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(source: string): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: 'limits.cs',
      fileUri: 'file:///fixtures/limits.cs'
    });
  } finally {
    tree.delete();
  }
}

function wrap(bodyLines: string[]): string {
  return [
    'public class L : CodedWorkflow',
    '{',
    '    [Workflow]',
    '    public void Execute()',
    '    {',
    ...bodyLines.map((l) => `        ${l}`),
    '    }',
    '}',
    ''
  ].join('\n');
}

/** All containers in a tree with their 1-based depth. */
function collectContainers(
  children: CwStatement[],
  depth = 1
): { container: CwContainer; depth: number }[] {
  const out: { container: CwContainer; depth: number }[] = [];
  for (const child of children) {
    if (child.type !== 'container') continue;
    out.push({ container: child, depth });
    for (const slot of child.slots) {
      out.push(...collectContainers(slot.children, depth + 1));
    }
  }
  return out;
}

/** Leaf-statement count of a rendered tree (chips count statementCount). */
function countLeaves(children: CwStatement[]): number {
  let total = 0;
  for (const child of children) {
    switch (child.type) {
      case 'activity':
      case 'pseudo':
        total += 1;
        break;
      case 'raw':
        total += child.statementCount;
        break;
      case 'container':
        if (child.resourceCard !== undefined) total += 1;
        for (const slot of child.slots) total += countLeaves(slot.children);
        break;
    }
  }
  return total;
}

describe('limits — constants', () => {
  it('exports the spec values', () => {
    expect(COLLAPSE_STATEMENT_THRESHOLD).toBe(200);
    expect(MAX_RENDER_STATEMENTS).toBe(600);
    expect(CHIP_CODE_MAX_LINES).toBe(40);
    expect(HEADER_MAX_CHARS).toBe(80);
    expect(COLLAPSE_ALL_STATEMENTS).toBe(1000);
    expect(COLLAPSE_TOTAL_LINES).toBe(800);
    expect(COLLAPSE_CONTAINER_LINES).toBe(150);
  });
});

describe('collapsedByDefault pass', () => {
  it('keeps everything expanded on small files', async () => {
    const model = await build(
      wrap(['if (a) { x = 1; }', 'if (b) { if (c) { y = 2; } }'])
    );
    const containers = collectContainers(model.classes[0].entryPoints[0].body);
    expect(containers.length).toBe(3);
    expect(containers.every((c) => !c.container.collapsedByDefault)).toBe(true);
  });

  it('collapses any container spanning more than COLLAPSE_CONTAINER_LINES lines', async () => {
    const filler = Array.from({ length: COLLAPSE_CONTAINER_LINES + 5 }, () => '// pad');
    const model = await build(
      wrap(['if (a)', '{', ...filler, '    x = 1;', '}', 'if (b) { y = 2; }'])
    );
    const containers = collectContainers(model.classes[0].entryPoints[0].body);
    expect(containers[0].container.collapsedByDefault).toBe(true); // tall
    expect(containers[1].container.collapsedByDefault).toBe(false); // short
  });

  it('collapses depth>=2 above COLLAPSE_STATEMENT_THRESHOLD statements', async () => {
    const padding = Array.from(
      { length: COLLAPSE_STATEMENT_THRESHOLD + 10 },
      (_, i) => `pad = ${i};`
    );
    const model = await build(
      wrap([...padding, 'if (a) { if (b) { x = 1; } }'])
    );
    expect(model.stats.totalStatements).toBeGreaterThan(COLLAPSE_STATEMENT_THRESHOLD);
    const containers = collectContainers(model.classes[0].entryPoints[0].body);
    const outer = containers.find((c) => c.depth === 1)!;
    const inner = containers.find((c) => c.depth === 2)!;
    expect(outer.container.collapsedByDefault).toBe(false);
    expect(inner.container.collapsedByDefault).toBe(true);
  });

  it('collapses depth>=2 above COLLAPSE_TOTAL_LINES total lines', async () => {
    const padding = Array.from({ length: COLLAPSE_TOTAL_LINES + 10 }, () => '// pad');
    const model = await build(
      wrap([...padding, 'if (a) { if (b) { x = 1; } }'])
    );
    expect(model.totalLines).toBeGreaterThan(COLLAPSE_TOTAL_LINES);
    const containers = collectContainers(model.classes[0].entryPoints[0].body);
    expect(containers.find((c) => c.depth === 1)!.container.collapsedByDefault).toBe(false);
    expect(containers.find((c) => c.depth === 2)!.container.collapsedByDefault).toBe(true);
  });
});

describe('truncation pass — fold beyond MAX_RENDER_STATEMENTS', () => {
  it('folds the remainder into one terminal chip with exact accounting', async () => {
    // 650 Log cards: each is one rendered child, so the cut is exact.
    const calls = Array.from({ length: 650 }, (_, i) => `Log("step ${i}");`);
    const model = await build(wrap(calls));
    const entry = model.classes[0].entryPoints[0];

    expect(model.truncated).toBe(true);
    expect(entry.body).toHaveLength(MAX_RENDER_STATEMENTS + 1);

    const fold = entry.body[entry.body.length - 1] as CwRawChip;
    expect(fold.type).toBe('raw');
    expect(fold.statementCount).toBe(650 - MAX_RENDER_STATEMENTS);
    expect(fold.id).toBe(`L#Execute/${MAX_RENDER_STATEMENTS}`);

    // Pre-truncation totals: the 650 Log calls were classified tier-1.
    expect(model.stats.totalStatements).toBe(650);
    expect(entry.tierCounts).toEqual({ tier1: 650, tier2: 0, tier3: 0 });
    // The rendered tree still accounts for every statement.
    expect(countLeaves(entry.body)).toBe(650);
  });

  it('does not truncate at or below the threshold', async () => {
    const calls = Array.from({ length: 30 }, (_, i) => `Log("step ${i}");`);
    const model = await build(wrap(calls));
    expect(model.truncated).toBe(false);
    expect(model.classes[0].entryPoints[0].body).toHaveLength(30);
  });
});

describe('scale — two-thousand-lines fixture (perf + flags + accounting)', () => {
  it('parses and classifies a 2000-line file within a smoke budget, with collapse + truncation engaged', async () => {
    const source = loadFixture('scale/two-thousand-lines.cs');
    const parser = await getCSharpParser();

    const start = nowMs();
    const tree = parser.parse(source);
    const parseMs = nowMs() - start;
    let model: CodedWorkflowModel;
    try {
      model = buildModel(tree, source, {
        fileName: 'two-thousand-lines.cs',
        fileUri: 'file:///fixtures/scale/two-thousand-lines.cs',
        parseMs
      });
    } finally {
      tree.delete();
    }
    const totalMs = nowMs() - start;

    expect(model.parseHealth).toBe('ok');
    expect(model.totalLines).toBeGreaterThanOrEqual(2000);
    // 2 declarations + 230 blocks x 6 leaves.
    expect(model.stats.totalStatements).toBe(1382);

    // Collapse: >1000 statements → every container collapses (depth >= 1).
    const entry = model.classes[0].entryPoints[0];
    const containers = collectContainers(entry.body);
    expect(containers.length).toBeGreaterThan(0);
    expect(containers.every((c) => c.container.collapsedByDefault)).toBe(true);

    // Truncation: rendered children stop near the cap; the fold chip carries
    // the rest and the totals still add up.
    expect(model.truncated).toBe(true);
    const fold = entry.body[entry.body.length - 1] as CwRawChip;
    expect(fold.type).toBe('raw');
    expect(fold.codeTruncated).toBe(true); // the remainder is >40 lines
    const kept = countLeaves(entry.body.slice(0, -1));
    expect(kept).toBeGreaterThanOrEqual(MAX_RENDER_STATEMENTS);
    expect(kept).toBeLessThan(MAX_RENDER_STATEMENTS + 10);
    expect(kept + fold.statementCount).toBe(model.stats.totalStatements);

    // Generous smoke bound: real parse+classify cost is ~260ms on CI runners.
    // This catches a catastrophic regression (e.g. accidental O(n^2)), not
    // normal runner jitter (a tighter 250ms bound flaked on macOS CI). Precise
    // perf is tracked out-of-band via scripts/graphPerf.mjs + docs/m1-verification.md.
    expect(totalMs).toBeLessThan(2000);
  });
});
