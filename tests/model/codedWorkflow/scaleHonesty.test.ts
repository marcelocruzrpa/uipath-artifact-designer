/**
 * Honesty-at-scale invariant for the 2000-line scale fixture (a NEW file — the
 * existing limits.test.ts asserts perf + collapse + truncation accounting; this
 * pins the TIER split).
 *
 * The fixture's bodies repeat, per step:
 *   Log("step N start");                 → tier-1 activity card
 *   var valueN = system.GetAsset("...")  → tier-1 activity card (assigned)
 *   counter = counter + N;               → ARITHMETIC assign  → tier-3 raw chip
 *   if (counter > N) { ... }             → container
 *     Log("step N hot");                 → tier-1
 *     counter = counter - 1;             → ARITHMETIC assign  → tier-3 raw chip
 *   total = total + counter;             → ARITHMETIC assign  → tier-3 raw chip
 * plus two literal-RHS initializers at the top:
 *   var counter = 0; / var total = 0;    → tier-2 `assign-literal` pseudo-steps
 *
 * The INVARIANT: the arithmetic assignments stay HONEST tier-3 raw chips — they
 * are NOT swallowed by a tier-2 `assign-*` rule (which only matches literal /
 * call / new-object RHS, never an arithmetic expression).  Only the two
 * literal-RHS initializers are tier-2.  This guards against a future tier-2 rule
 * over-reaching and pretending arithmetic is a recognized "Assign" step.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type {
  CodedWorkflowModel,
  CwPseudoStep,
  CwRawChip,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function build(): Promise<CodedWorkflowModel> {
  const src = loadFixture('scale/two-thousand-lines.cs');
  const tree = (await getCSharpParser()).parse(src);
  try {
    return buildModel(tree, src, {
      fileName: 'two-thousand-lines.cs',
      fileUri: 'file:///fixtures/scale/two-thousand-lines.cs'
    });
  } finally {
    tree.delete();
  }
}

/** Depth-first flatten of a body, descending container slots. */
function flatten(children: CwStatement[]): CwStatement[] {
  const out: CwStatement[] = [];
  for (const c of children) {
    out.push(c);
    if (c.type === 'container') for (const s of c.slots) out.push(...flatten(s.children));
  }
  return out;
}

describe('honesty-at-scale — tier split', () => {
  it('keeps the bulk of statements at tier-3 (raw), not tier-2', async () => {
    const model = await build();
    // Pre-truncation totals (limits.test.ts pins totalStatements === 1382).
    // The honest split: the arithmetic assignments dominate tier-3; only the two
    // literal initializers are tier-2.
    expect(model.stats.tier2).toBe(2);
    expect(model.stats.tier3).toBeGreaterThan(model.stats.tier2);
    // Sanity: the three tiers sum to the total.
    expect(model.stats.tier1 + model.stats.tier2 + model.stats.tier3)
      .toBe(model.stats.totalStatements);
  });

  it('classifies arithmetic assignments as tier-3 raw chips, NOT tier-2', async () => {
    const model = await build();
    const all = flatten(model.classes[0].entryPoints[0].body);

    // Every `counter = counter + N;` / `counter = counter - 1;` / `total = ...`
    // that survives into the rendered tree is a RAW chip.
    const arithChips = all.filter(
      (s): s is CwRawChip =>
        s.type === 'raw' &&
        (s.code.includes('counter = counter +') ||
          s.code.includes('counter = counter -') ||
          s.code.includes('total = total +'))
    );
    expect(arithChips.length).toBeGreaterThan(0);

    // No tier-2 pseudo-step ever captured an arithmetic assignment.
    const pseudos = all.filter((s): s is CwPseudoStep => s.type === 'pseudo');
    for (const p of pseudos) {
      expect(p.text.includes('+ ')).toBe(false);
      expect(p.text.includes(' - ')).toBe(false);
    }
    // The only pseudo-steps are the two literal-RHS initializers.
    expect(pseudos.every((p) => p.ruleId === 'assign-literal')).toBe(true);
  });
});
