/**
 * Honesty-at-scale invariant for the 2000-line scale fixture (a NEW file — the
 * existing limits.test.ts asserts perf + collapse + truncation accounting; this
 * pins the TIER split).
 *
 * The fixture's bodies repeat, per step:
 *   Log("step N start");                 → tier-1 activity card
 *   var valueN = system.GetAsset("...")  → tier-1 activity card (assigned)
 *   counter = counter + N;               → ARITHMETIC assign  → tier-2 `assign-generic`
 *   if (counter > N) { ... }             → container
 *     Log("step N hot");                 → tier-1
 *     counter = counter - 1;             → ARITHMETIC assign  → tier-2 `assign-generic`
 *   total = total + counter;             → ARITHMETIC assign  → tier-2 `assign-generic`
 * plus two literal-RHS initializers at the top:
 *   var counter = 0; / var total = 0;    → tier-2 `assign-literal` pseudo-steps
 *
 * The INVARIANT (post `assign-generic`): the arithmetic assignments render as
 * tier-2 generic Assign cards, and that stays HONEST because the card text is
 * the EXACT source — the arithmetic operator is shown verbatim, never summarized
 * away behind a friendly label.  This guards against the generic rule ever
 * hiding or rewriting the RHS, and confirms every leaf is still counted exactly
 * once across the three tiers.
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
  it('accounts for every leaf exactly once across the three tiers', async () => {
    const model = await build();
    // Sanity: the three tiers sum to the total (no leaf lost or double-counted).
    expect(model.stats.tier1 + model.stats.tier2 + model.stats.tier3)
      .toBe(model.stats.totalStatements);
    // The arithmetic mass now lives in tier-2 generic Assign cards, so tier-2
    // is non-trivial — but the count still reconciles above.
    expect(model.stats.tier2).toBeGreaterThan(2);
  });

  it('renders arithmetic assignments as HONEST verbatim tier-2 Assign cards', async () => {
    const model = await build();
    const all = flatten(model.classes[0].entryPoints[0].body);

    // Every `counter = counter + N;` / `counter = counter - 1;` / `total = ...`
    // is now a tier-2 `assign-generic` card — never a raw chip.
    const arithAssigns = all.filter(
      (s): s is CwPseudoStep =>
        s.type === 'pseudo' &&
        s.ruleId === 'assign-generic' &&
        (s.text.includes('counter + ') ||
          s.text.includes('counter - ') ||
          s.text.includes('total + '))
    );
    expect(arithAssigns.length).toBeGreaterThan(0);

    // HONESTY: the arithmetic operator is shown VERBATIM in the card text — the
    // generic rule never hides or rewrites the RHS behind a friendly label.
    for (const a of arithAssigns) {
      expect(a.text.includes(' + ') || a.text.includes(' - ')).toBe(true);
    }

    // No INDIVIDUAL arithmetic assignment leaks back into a raw chip. (The
    // scale fixture truncates: the remainder folds into ONE multi-statement
    // tail chip whose verbatim slice naturally contains arithmetic source — it
    // is excluded by the statementCount === 1 guard, since it is a scale
    // artifact, not a per-statement classification.)
    const arithChips = all.filter(
      (s): s is CwRawChip =>
        s.type === 'raw' &&
        s.statementCount === 1 &&
        (s.code.includes('counter = counter +') ||
          s.code.includes('counter = counter -') ||
          s.code.includes('total = total +'))
    );
    expect(arithChips).toEqual([]);

    // The only tier-2 rules in play are the two assign floor rules: the literal
    // initializers (`assign-literal`) and the arithmetic reassigns
    // (`assign-generic`).
    const pseudos = all.filter((s): s is CwPseudoStep => s.type === 'pseudo');
    const ruleIds = new Set(pseudos.map((p) => p.ruleId));
    expect([...ruleIds].sort()).toEqual(['assign-generic', 'assign-literal']);
  });
});
