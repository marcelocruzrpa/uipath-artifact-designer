/**
 * T3.1 — tier-2 STRUCTURAL GUARDS: registry budget, id uniqueness, family
 * whitelist, m0Rank ordering, fixture evidence, and manifest parity against
 * `src/model/codedWorkflow/classify/tier2-rules.md`.
 *
 * These guards enforce the cap discipline on the 10 shipped tier-2 rules: each
 * rule must carry corpus provenance (m0Rank order), fixture evidence (≥2 golden
 * pairs + ≥1 near-miss under `tests/fixtures/codedWorkflow/tier2/<id>/`), and a
 * manifest row whose id cell has had its `*(proposed)*` marker removed — or
 * these tests fail.  Deleting a rule without deleting its fixtures (or
 * re-marking its manifest row) fails them too.
 *
 * Each guard collects offenders and asserts the collection is empty, so every
 * test makes a real assertion against the live registry.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TIER2_RULES,
  MAX_TIER2_RULES,
  TIER2_FAMILY_ICONS,
  type Tier2Rule
} from '../../../src/model/codedWorkflow/classify/tier2Rules';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(PROJECT_ROOT, 'tests', 'fixtures', 'codedWorkflow', 'tier2');
const MANIFEST_PATH = join(PROJECT_ROOT, 'src', 'model', 'codedWorkflow', 'classify', 'tier2-rules.md');

const ALLOWED_FAMILIES: readonly Tier2Rule['family'][] = [
  'assign',
  'string',
  'linq',
  'collection',
  'file',
  'datetime',
  'console'
];

/**
 * (d) Rule ids EXEMPT from the m0Rank-ascending ordering check.  EMPTY by
 * design.  The evaluator is first-match-wins, so registry order is semantic:
 * if a more-specific rule must run before a more-general one DESPITE a lower
 * corpus rank, add its id here WITH a comment explaining the dispatch
 * dependency — never silently reorder.
 */
const SORT_ORDER_EXCEPTIONS: readonly string[] = [];

const ruleIds = TIER2_RULES.map((rule) => rule.id as string);

// ---------------------------------------------------------------------------
// Registry-shape guards
// ---------------------------------------------------------------------------

describe('tier-2 structural guards — registry', () => {
  it('(a) stays within the MAX_TIER2_RULES budget', () => {
    expect(TIER2_RULES.length).toBeLessThanOrEqual(MAX_TIER2_RULES);
    // The cap itself is part of the contract (src/model/codedWorkflow/classify/tier2-rules.md: "the cap
    // stays at 15") — raising it must be a deliberate two-file change.
    expect(MAX_TIER2_RULES).toBe(15);
  });

  it('(b) rule ids are unique', () => {
    const duplicates = ruleIds.filter((id, index) => ruleIds.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('(c) every family comes from the allowed set and has an icon', () => {
    const offenders = TIER2_RULES.filter(
      (rule) =>
        !ALLOWED_FAMILIES.includes(rule.family) || !(rule.family in TIER2_FAMILY_ICONS)
    ).map((rule) => `${rule.id}: ${rule.family}`);
    expect(offenders).toEqual([]);
    // The icon record covers exactly the allowed set (a family without an
    // icon would render pseudo-steps with an undefined codicon).
    expect(Object.keys(TIER2_FAMILY_ICONS).sort()).toEqual([...ALLOWED_FAMILIES].sort());
  });

  it('(d) registry is sorted by m0Rank ascending, ties stable by id', () => {
    const checked = TIER2_RULES.filter(
      (rule) => !SORT_ORDER_EXCEPTIONS.includes(rule.id as string)
    );
    const violations: string[] = [];
    for (let i = 1; i < checked.length; i += 1) {
      const prev = checked[i - 1];
      const curr = checked[i];
      const ordered =
        prev.m0Rank < curr.m0Rank ||
        (prev.m0Rank === curr.m0Rank && (prev.id as string) < (curr.id as string));
      if (!ordered) {
        violations.push(
          `${prev.id} (rank ${prev.m0Rank}) listed before ${curr.id} (rank ${curr.m0Rank})`
        );
      }
    }
    expect(violations).toEqual([]);
    // A stale exception (rule renamed/deleted) is itself a failure.
    const staleExceptions = SORT_ORDER_EXCEPTIONS.filter((id) => !ruleIds.includes(id));
    expect(staleExceptions).toEqual([]);
  });

  it('(g) every rule has a non-empty doc and non-empty templates', () => {
    // Templates with `{capture}` placeholders are non-empty by construction;
    // static templates must be non-empty strings too — an empty template
    // would render a blank card title/text.
    const offenders = TIER2_RULES.filter(
      (rule) =>
        rule.doc.trim() === '' ||
        rule.titleTemplate.trim() === '' ||
        rule.textTemplate.trim() === ''
    ).map((rule) => rule.id as string);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (e) Fixture-evidence guards
// ---------------------------------------------------------------------------

describe('tier-2 structural guards — fixture evidence', () => {
  it('(e) every shipped rule has ≥2 golden pairs and ≥1 near-miss fixture', () => {
    const problems: string[] = [];
    for (const id of ruleIds) {
      const dir = join(FIXTURE_ROOT, id);
      if (!existsSync(dir)) {
        problems.push(`${id}: missing fixture directory tier2/${id}/`);
        continue;
      }
      const files = readdirSync(dir);
      const goldenPairs = files.filter(
        (f) => /^golden-\d{2}\.cs$/.test(f) && files.includes(f.replace(/\.cs$/, '.txt'))
      );
      const nearMisses = files.filter((f) => /^nearmiss-\d{2}\.cs$/.test(f));
      if (goldenPairs.length < 2) {
        problems.push(`${id}: ${goldenPairs.length} golden .cs/.txt pair(s), need ≥2`);
      }
      if (nearMisses.length < 1) {
        problems.push(`${id}: no near-miss fixture, need ≥1`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('(e) no orphan fixture directories without a registered rule', () => {
    // Catches a deleted/renamed rule leaving its fixtures behind.
    const fixtureDirs = readdirSync(FIXTURE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const orphans = fixtureDirs.filter((dir) => !ruleIds.includes(dir));
    expect(orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) Manifest parity — src/model/codedWorkflow/classify/tier2-rules.md "## Active rules" table
// ---------------------------------------------------------------------------

interface ManifestRow {
  id: string;
  /** True while the id cell carries the `*(proposed)*` marker (rule not shipped). */
  proposed: boolean;
  nearMissBoundary: string;
}

/** Split a markdown table row on UNESCAPED pipes, dropping the outer empties. */
function splitTableRow(row: string): string[] {
  return row
    .trim()
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/**
 * Parse the "## Active rules" table.  Convention (documented above the table
 * in the manifest): a row is ACTIVE only when its backticked id appears
 * WITHOUT the `*(proposed)*` marker; T3.2 removes the marker as each rule
 * ships.  Columns: # | id | family | M0 rank | Est. stmts | Rationale |
 * Near-miss boundary.
 */
function parseActiveRulesTable(markdown: string): ManifestRow[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+Active rules/.test(line));
  if (start < 0) throw new Error('src/model/codedWorkflow/classify/tier2-rules.md: missing "## Active rules" heading');
  let end = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
  if (end < 0) end = lines.length;

  const tableLines = lines.slice(start + 1, end).filter((line) => line.trim().startsWith('|'));
  if (tableLines.length < 2) throw new Error('Active-rules table not found under the heading');
  if (!/\bid\b/.test(tableLines[0]) || !/-{3}/.test(tableLines[1])) {
    throw new Error('Active-rules table header/separator rows not in the expected shape');
  }

  return tableLines.slice(2).map((row) => {
    const cells = splitTableRow(row);
    if (cells.length !== 7) {
      throw new Error(`malformed Active-rules row (${cells.length} cells): ${row}`);
    }
    const idMatch = /`([^`]+)`/.exec(cells[1]);
    if (idMatch === null) throw new Error(`Active-rules row has no backticked id: ${row}`);
    return {
      id: idMatch[1],
      proposed: /\(proposed\)/.test(cells[1]),
      nearMissBoundary: cells[6]
    };
  });
}

describe('tier-2 structural guards — manifest parity (src/model/codedWorkflow/classify/tier2-rules.md)', () => {
  it('parses the Active-rules table (parser sanity)', () => {
    const rows = parseActiveRulesTable(readFileSync(MANIFEST_PATH, 'utf8'));
    // The manifest lists 10 shipped rules; the table can never exceed
    // the cap.  This pins the parser against silent format drift — if the
    // table shape changes, fix the parser, not the guard.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(MAX_TIER2_RULES);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every manifest row — proposed or shipped — must document its near-miss
    // boundary; an empty cell means the rule's edge was never thought through.
    const blankBoundaries = rows.filter((row) => row.nearMissBoundary === '').map((r) => r.id);
    expect(blankBoundaries).toEqual([]);
  });

  it('(f) non-proposed manifest ids equal the shipped TIER2_RULES ids', () => {
    const rows = parseActiveRulesTable(readFileSync(MANIFEST_PATH, 'utf8'));
    const activeIds = rows.filter((row) => !row.proposed).map((row) => row.id).sort();
    expect(activeIds).toEqual([...ruleIds].sort());
  });

  it('(f) every shipped rule has a manifest row with a non-empty near-miss boundary', () => {
    const rows = parseActiveRulesTable(readFileSync(MANIFEST_PATH, 'utf8'));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const problems: string[] = [];
    for (const id of ruleIds) {
      const row = byId.get(id);
      if (row === undefined) {
        problems.push(`${id}: no Active-rules manifest row`);
      } else if (row.nearMissBoundary === '') {
        problems.push(`${id}: empty near-miss boundary cell`);
      }
    }
    expect(problems).toEqual([]);
  });
});
