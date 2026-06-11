/**
 * T3.1 — tier-2 transpiler GOLDEN HARNESS (data-driven).
 *
 * Discovers per-rule fixture directories under
 * `tests/fixtures/codedWorkflow/tier2/<ruleId>/` at collection time and
 * generates, for each:
 *
 *   golden-NN.cs + golden-NN.txt — the snippet is wrapped in the canonical
 *     scaffold, parsed, and classified by the REAL pipeline (real
 *     `buildModel`, real `TIER2_RULES` — no injection).  EXACTLY ONE tier-2
 *     pseudo-step must come out of the whole body (goldens are
 *     single-statement snippets by convention), it must carry the
 *     directory's rule id, and its rendered `${title} | ${text}` must
 *     byte-equal the `.txt` content (CRLF→LF normalized, at most ONE
 *     trailing newline trimmed — everything else is byte-exact).
 *
 *   nearmiss-NN.cs [+ nearmiss-NN.expect] — the snippet must NOT match the
 *     directory's rule anywhere in the body, and the single statement's
 *     classification must equal the `.expect` content: `tier3` (the default
 *     when no `.expect` file exists — the statement renders as a RAW CHIP),
 *     `tier1` (an activity card), or another rule id (that OTHER rule's
 *     pseudo-step).
 *
 * The shipped registry is EMPTY today (T3.2 lands the rules), so the
 * data-driven section is vacuous — the `discovery` test pins the
 * fixture-directory set to the shipped rule-id set (proving the harness ran,
 * and doubling as evidence coverage once rules land), and the
 * `harness self-test` block proves the harness mechanics with inline fake
 * rules injected through the `BuildModelInput.tier2Rules` test seam — no
 * fixture files, no touching the shipped registry.
 *
 * Fixture layout doc: tests/fixtures/codedWorkflow/tier2/README.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import {
  TIER2_RULES,
  type Tier2Rule
} from '../../../src/model/codedWorkflow/classify/tier2Rules';
import type {
  CodedWorkflowModel,
  CwPseudoStep,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

const FIXTURE_ROOT = join(__dirname, '..', '..', 'fixtures', 'codedWorkflow', 'tier2');

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

// ---------------------------------------------------------------------------
// Harness mechanics — exercised by the data-driven tests AND the self-test,
// so the self-test proves exactly the code paths the goldens will run on.
// ---------------------------------------------------------------------------

/** The canonical scaffold every fixture snippet is wrapped in. */
function wrapSnippet(snippet: string): string {
  return `class W : CodedWorkflow { [Workflow] public void Execute() { ${snippet} } }`;
}

/** CRLF→LF, then trim AT MOST ONE trailing newline — the rest is byte-exact. */
function normalizeFixtureText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

/** The rendered form a golden `.txt` pins. */
function renderGolden(step: CwPseudoStep): string {
  return `${step.title} | ${step.text}`;
}

/**
 * Parse + classify a snippet through the REAL pipeline.  `tier2Rules` is
 * passed ONLY by the harness self-test; the data-driven golden/near-miss
 * tests leave it undefined so `buildModel` uses the shipped registry.
 */
async function buildFromSnippet(
  snippet: string,
  tier2Rules?: readonly Tier2Rule[]
): Promise<CodedWorkflowModel> {
  const parser = await getCSharpParser();
  const source = wrapSnippet(snippet);
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: 'tier2-golden.cs',
      fileUri: 'file:///fixtures/tier2-golden.cs',
      ...(tier2Rules !== undefined ? { tier2Rules } : {})
    });
  } finally {
    tree.delete();
  }
}

/** Depth-first flatten of a body, descending into container slots. */
function flatten(children: CwStatement[]): CwStatement[] {
  const out: CwStatement[] = [];
  for (const child of children) {
    out.push(child);
    if (child.type === 'container') {
      for (const slot of child.slots) out.push(...flatten(slot.children));
    }
  }
  return out;
}

/** The Execute() body of a scaffolded snippet, with parse-health guards. */
function entryBody(model: CodedWorkflowModel): CwStatement[] {
  expect(model.parseHealth, 'fixture snippet must parse cleanly').toBe('ok');
  expect(model.classes).toHaveLength(1);
  expect(model.classes[0].entryPoints).toHaveLength(1);
  return model.classes[0].entryPoints[0].body;
}

/** Golden assertion: exactly one pseudo-step, right rule, byte-exact render. */
async function assertGolden(
  ruleId: string,
  snippet: string,
  expected: string,
  tier2Rules?: readonly Tier2Rule[]
): Promise<void> {
  const model = await buildFromSnippet(snippet, tier2Rules);
  const pseudos = flatten(entryBody(model)).filter(
    (s): s is CwPseudoStep => s.type === 'pseudo'
  );
  expect(pseudos, 'exactly ONE tier-2 pseudo-step per golden snippet').toHaveLength(1);
  expect(pseudos[0].ruleId).toBe(ruleId);
  expect(renderGolden(pseudos[0])).toBe(expected);
}

/**
 * Near-miss assertion: the named rule did NOT match anywhere, and the
 * snippet's single statement classifies per `expectation` —
 * `tier3` → raw chip, `tier1` → activity card, anything else → a
 * pseudo-step from that OTHER rule id.
 */
async function assertNearMiss(
  ruleId: string,
  snippet: string,
  expectation: string,
  tier2Rules?: readonly Tier2Rule[]
): Promise<void> {
  const model = await buildFromSnippet(snippet, tier2Rules);
  const body = entryBody(model);
  const offenders = flatten(body).filter(
    (s) => s.type === 'pseudo' && s.ruleId === ruleId
  );
  expect(offenders, `rule ${ruleId} must NOT match a near-miss snippet`).toEqual([]);
  // Single-statement convention (see fixture README).
  expect(body, 'near-miss snippets are single statements').toHaveLength(1);
  const stmt = body[0];
  if (expectation === 'tier3') {
    expect(stmt.type, 'default near-miss expectation: a raw chip').toBe('raw');
  } else if (expectation === 'tier1') {
    expect(stmt.type, '.expect tier1: an activity card').toBe('activity');
  } else {
    expect(stmt.type, `.expect ${expectation}: that rule's pseudo-step`).toBe('pseudo');
    expect((stmt as CwPseudoStep).ruleId).toBe(expectation);
  }
}

// ---------------------------------------------------------------------------
// Discovery — the fixture-directory set IS the harness's table of contents.
// ---------------------------------------------------------------------------

const ruleDirs = readdirSync(FIXTURE_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('tier-2 golden harness — discovery', () => {
  it('fixture directories equal the shipped TIER2_RULES ids exactly', () => {
    // PASSES VACUOUSLY TODAY (both sides empty) but proves the harness ran,
    // and becomes the evidence-coverage gate the moment T3.2 ships a rule:
    // a rule without fixtures fails here, and so does an orphan directory.
    const shippedIds = TIER2_RULES.map((rule) => rule.id as string).sort();
    expect(ruleDirs).toEqual(shippedIds);
  });
});

for (const ruleId of ruleDirs) {
  const dir = join(FIXTURE_ROOT, ruleId);
  const files = readdirSync(dir).sort();
  const goldenCs = files.filter((f) => /^golden-\d{2}\.cs$/.test(f));
  const nearMissCs = files.filter((f) => /^nearmiss-\d{2}\.cs$/.test(f));

  describe(`tier-2 golden harness — ${ruleId}`, () => {
    it('contains only well-formed fixture files', () => {
      const problems: string[] = [];
      for (const f of files) {
        if (!/^golden-\d{2}\.(cs|txt)$/.test(f) && !/^nearmiss-\d{2}\.(cs|expect)$/.test(f)) {
          problems.push(`unexpected file: ${f}`);
        }
      }
      for (const f of goldenCs) {
        if (!files.includes(f.replace(/\.cs$/, '.txt'))) {
          problems.push(`${f} has no matching .txt`);
        }
      }
      for (const f of files.filter((name) => /^golden-\d{2}\.txt$/.test(name))) {
        if (!files.includes(f.replace(/\.txt$/, '.cs'))) {
          problems.push(`${f} has no matching .cs`);
        }
      }
      for (const f of files.filter((name) => /^nearmiss-\d{2}\.expect$/.test(name))) {
        if (!files.includes(f.replace(/\.expect$/, '.cs'))) {
          problems.push(`${f} has no matching .cs`);
        }
      }
      expect(problems).toEqual([]);
    });

    for (const csName of goldenCs) {
      it(`${csName} renders the pinned card byte-exactly`, async () => {
        const snippet = normalizeFixtureText(readFileSync(join(dir, csName), 'utf8'));
        const expected = normalizeFixtureText(
          readFileSync(join(dir, csName.replace(/\.cs$/, '.txt')), 'utf8')
        );
        await assertGolden(ruleId, snippet, expected);
      });
    }

    for (const csName of nearMissCs) {
      it(`${csName} does not match ${ruleId}`, async () => {
        const snippet = normalizeFixtureText(readFileSync(join(dir, csName), 'utf8'));
        const expectPath = join(dir, csName.replace(/\.cs$/, '.expect'));
        const expectation = existsSync(expectPath)
          ? normalizeFixtureText(readFileSync(expectPath, 'utf8')).trim()
          : 'tier3';
        await assertNearMiss(ruleId, snippet, expectation);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Harness self-test — inline fake rules + inline snippet strings (NO fixture
// files), injected through the buildModel test seam.  Proves the mechanics
// the data-driven section cannot exercise while TIER2_RULES is empty.
// ---------------------------------------------------------------------------

/** Test-only rule: matches `flag = <value>;` (same shape as chips.test.ts). */
const fakeAssignRule = {
  id: 'test.assignFlag',
  family: 'assign',
  m0Rank: 1,
  doc: 'self-test only: captures the lhs/rhs of `flag = <value>;`',
  match(stmt, source) {
    if (stmt.type !== 'expression_statement') return null;
    const text = source.slice(stmt.startIndex, stmt.endIndex);
    const m = /^flag = (.+);$/.exec(text);
    return m === null ? null : { captures: { name: 'flag', value: m[1] } };
  },
  titleTemplate: 'Assign {name}',
  textTemplate: '{name} = {value}'
} as unknown as Tier2Rule;

/** Test-only rule: matches any expression statement. */
const fakeCatchAllRule = {
  id: 'test.catchAll',
  family: 'console',
  m0Rank: 2,
  doc: 'self-test only: matches any expression statement',
  match(stmt) {
    return stmt.type === 'expression_statement' ? { captures: {} } : null;
  },
  titleTemplate: 'Catch All',
  textTemplate: 'matched'
} as unknown as Tier2Rule;

describe('harness self-test', () => {
  it('wraps snippets in the canonical CodedWorkflow scaffold', async () => {
    expect(wrapSnippet('flag = true;')).toBe(
      'class W : CodedWorkflow { [Workflow] public void Execute() { flag = true; } }'
    );
    const model = await buildFromSnippet('flag = true;');
    expect(model.parseHealth).toBe('ok');
    expect(model.classes[0].entryPoints.map((e) => e.name)).toEqual(['Execute']);
    expect(model.classes[0].entryPoints[0].attribute).toBe('Workflow');
  });

  it('trims at most ONE trailing newline; everything else stays byte-exact', () => {
    expect(normalizeFixtureText('Assign x | x = 1\n')).toBe('Assign x | x = 1');
    expect(normalizeFixtureText('a\n\n')).toBe('a\n'); // only ONE newline trimmed
    expect(normalizeFixtureText('a \n')).toBe('a '); // trailing space preserved
    expect(normalizeFixtureText('a\r\nb\r\n')).toBe('a\nb'); // CRLF-normalized
  });

  it('golden path: byte-exact `${title} | ${text}` comparison works', async () => {
    await assertGolden(
      'test.assignFlag',
      'flag = true;',
      normalizeFixtureText('Assign flag | flag = true\n'),
      [fakeAssignRule]
    );
  });

  it('golden path: the exactly-one assertion is load-bearing', async () => {
    // Two matching statements produce two pseudo-steps — a golden written
    // that way would FAIL assertGolden's toHaveLength(1).
    const model = await buildFromSnippet('flag = 1; flag = 2;', [fakeAssignRule]);
    const pseudos = flatten(entryBody(model)).filter((s) => s.type === 'pseudo');
    expect(pseudos).toHaveLength(2);
  });

  it('near-miss path: default expectation is tier3 (raw chip)', async () => {
    await assertNearMiss('test.assignFlag', 'count = 2;', 'tier3', [fakeAssignRule]);
  });

  it('near-miss path: `.expect tier1` asserts an activity card', async () => {
    await assertNearMiss('test.assignFlag', 'Log("x");', 'tier1', [fakeAssignRule]);
  });

  it('near-miss path: `.expect <otherRuleId>` asserts that other rule matched', async () => {
    await assertNearMiss('test.assignFlag', 'other.Call();', 'test.catchAll', [
      fakeAssignRule,
      fakeCatchAllRule
    ]);
  });
});
