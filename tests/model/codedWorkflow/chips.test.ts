/**
 * Stage-C tests: adjacent raw-chip merging (`chips.ts`) and the tier-2
 * pseudo-step engine (`classify/tier2Rules.ts`).
 *
 * The shipped TIER2_RULES registry is EMPTY by design — the engine is proven
 * with LOCAL fake rules (cast test-only objects) injected through the
 * `tier2Rules` test seam on BuildModelInput, including the
 * tier1 > tier2 > chip dispatch order and `{capture}` template substitution.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  configureCSharpParserFromNodeModules,
  loadFixture,
  sliceBySpan
} from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import {
  TIER2_RULES,
  MAX_TIER2_RULES,
  applyTier2,
  type Tier2Rule
} from '../../../src/model/codedWorkflow/classify/tier2Rules';
import { CHIP_CODE_MAX_LINES } from '../../../src/model/codedWorkflow/limits';
import type {
  CodedWorkflowModel,
  CwPseudoStep,
  CwRawChip,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

const SOURCE = loadFixture('skeleton/chips-merge.cs');

let model: CodedWorkflowModel;

async function build(
  source: string,
  tier2Rules?: readonly Tier2Rule[]
): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: 'chips.cs',
      fileUri: 'file:///fixtures/chips.cs',
      ...(tier2Rules !== undefined ? { tier2Rules } : {})
    });
  } finally {
    tree.delete();
  }
}

beforeAll(async () => {
  configureCSharpParserFromNodeModules();
  model = await build(SOURCE);
});

function asChip(stmt: CwStatement | undefined): CwRawChip {
  expect(stmt?.type).toBe('raw');
  return stmt as CwRawChip;
}

describe('mergeAdjacentChips — runs, breaks, invariants', () => {
  it('merges adjacent chips and keeps cards/containers as run breakers', () => {
    const body = model.classes[0].entryPoints[0].body;
    expect(body.map((s) => s.type)).toEqual([
      'raw', // a + b + c merged
      'activity', // Log breaks the run
      'raw', // d + e merged
      'container', // if breaks the run
      'raw' // f alone
    ]);
    expect(body.map((s) => s.id)).toEqual([
      'Execute/0',
      'Execute/1',
      'Execute/2',
      'Execute/3',
      'Execute/4'
    ]);
    expect(asChip(body[0]).statementCount).toBe(3);
    expect(asChip(body[2]).statementCount).toBe(2);
    expect(asChip(body[4]).statementCount).toBe(1);
  });

  it('re-slices merged code from source with comments/blank lines verbatim', () => {
    const merged = asChip(model.classes[0].entryPoints[0].body[0]);
    expect(merged.code).toBe(sliceBySpan(SOURCE, merged.span));
    expect(merged.code.startsWith('var a = 1;')).toBe(true);
    expect(merged.code.endsWith('var c = a + b;')).toBe(true);
    expect(merged.code).toContain('// trailing comment stays inside the merged slice');
    expect(merged.code).toContain('// a standalone comment between chips is re-sliced verbatim');
    expect(merged.code).toContain('\n\n'); // the blank line survives
    expect(merged.lineCount).toBe(merged.span.endLine - merged.span.startLine + 1);
    expect(merged.codeTruncated).toBe(false);
  });

  it('keeps the span-derived lineCount but caps code at CHIP_CODE_MAX_LINES', () => {
    const big = model.classes[0].entryPoints[1];
    expect(big.name).toBe('Big');
    expect(big.body).toHaveLength(1);
    const chip = asChip(big.body[0]);
    expect(chip.statementCount).toBe(50);
    expect(chip.lineCount).toBe(50);
    expect(chip.codeTruncated).toBe(true);
    expect(chip.code.split('\n')).toHaveLength(CHIP_CODE_MAX_LINES);
    // The capped code is exactly the first 40 lines of the exact slice.
    const fullSlice = sliceBySpan(SOURCE, chip.span);
    expect(chip.code).toBe(fullSlice.split('\n').slice(0, CHIP_CODE_MAX_LINES).join('\n'));
    expect(big.tierCounts.tier3).toBe(50);
  });

  it('non-truncated chips always satisfy code === exact slice', () => {
    for (const entry of model.classes[0].entryPoints) {
      for (const stmt of entry.body) {
        if (stmt.type !== 'raw') continue;
        const chip = stmt as CwRawChip;
        if (!chip.codeTruncated) {
          expect(chip.code).toBe(sliceBySpan(SOURCE, chip.span));
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-2 engine — LOCAL fake rules only; the shipped registry stays empty.
// ---------------------------------------------------------------------------

/** Test-only rule: matches `flag = ...;` expression statements. */
const fakeAssignRule = {
  id: 'test.assignFlag',
  family: 'assign',
  m0Rank: 1,
  doc: 'test-only: captures the lhs/rhs of `flag = <value>;`',
  match(stmt, source) {
    if (stmt.type !== 'expression_statement') return null;
    const text = source.slice(stmt.startIndex, stmt.endIndex);
    const m = /^flag = (.+);$/.exec(text);
    if (m === null) return null;
    return { captures: { name: 'flag', value: m[1] } };
  },
  titleTemplate: 'Assign {name}',
  textTemplate: '{name} = {value}'
} as unknown as Tier2Rule;

/** Test-only rule: matches everything — used to prove first-match-wins. */
const fakeCatchAllRule = {
  id: 'test.catchAll',
  family: 'console',
  m0Rank: 2,
  doc: 'test-only: matches any expression statement',
  match(stmt) {
    return stmt.type === 'expression_statement' ? { captures: {} } : null;
  },
  titleTemplate: 'Catch All',
  textTemplate: 'matched'
} as unknown as Tier2Rule;

describe('tier-2 engine', () => {
  it('ships an EMPTY rule registry within the budget', () => {
    expect(TIER2_RULES).toEqual([]);
    expect(TIER2_RULES.length).toBeLessThanOrEqual(MAX_TIER2_RULES);
  });

  it('dispatches tier1 > tier2 > chip and substitutes {captures}', async () => {
    const source =
      'class W : CodedWorkflow { [Workflow] public void Execute() { Log("x"); flag = true; unknown.Call(1); } }';
    const m = await build(source, [fakeAssignRule]);
    const body = m.classes[0].entryPoints[0].body;

    // Tier-1 wins over the rule even though the rule would not match Log
    // anyway; the assignment matches the fake rule; the unknown call falls
    // through to a chip.
    expect(body.map((s) => s.type)).toEqual(['activity', 'pseudo', 'raw']);

    const pseudo = body[1] as CwPseudoStep;
    expect(pseudo.tier).toBe(2);
    expect(pseudo.ruleId).toBe('test.assignFlag');
    expect(pseudo.title).toBe('Assign flag');
    expect(pseudo.text).toBe('flag = true');
    expect(pseudo.icon.length).toBeGreaterThan(0);

    expect(m.classes[0].entryPoints[0].tierCounts).toEqual({
      tier1: 1,
      tier2: 1,
      tier3: 1
    });
    expect(m.stats.tier2).toBe(1);
  });

  it('tier-1 statements never reach the rules (catch-all proves order)', async () => {
    const source =
      'class W : CodedWorkflow { [Workflow] public void Execute() { Log("x"); other.Call(); } }';
    const m = await build(source, [fakeCatchAllRule]);
    const body = m.classes[0].entryPoints[0].body;
    expect(body[0].type).toBe('activity'); // not 'pseudo'
    expect(body[1].type).toBe('pseudo');
  });

  it('first match wins when several rules match', async () => {
    const { stmt, source } = await parseFlagStatement();
    const step = applyTier2(stmt, source, [fakeAssignRule, fakeCatchAllRule]);
    expect(step).not.toBeNull();
    expect(step!.ruleId).toBe('test.assignFlag');

    const reversed = applyTier2(stmt, source, [fakeCatchAllRule, fakeAssignRule]);
    expect(reversed!.ruleId).toBe('test.catchAll');
  });

  it('returns null when no rule matches (and on the empty shipped registry)', async () => {
    const { stmt, source } = await parseFlagStatement();
    expect(applyTier2(stmt, source, [])).toBeNull();
    expect(applyTier2(stmt, source)).toBeNull(); // shipped registry is empty
  });
});

async function parseFlagStatement() {
  const source =
    'class W : CodedWorkflow { [Workflow] public void Execute() { flag = true; } }';
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  const classBody = tree.rootNode.namedChildren
    .find((n) => n.type === 'class_declaration')!
    .childForFieldName('body')!;
  const method = classBody.namedChildren.find((n) => n.type === 'method_declaration')!;
  const stmt = method.childForFieldName('body')!.namedChildren[0];
  return { stmt, source };
}
