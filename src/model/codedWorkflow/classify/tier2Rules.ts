/**
 * Tier-2 "transpiler" rule engine: a small whitelist of statement patterns
 * rendered as friendly pseudo-steps (`CwPseudoStep`) instead of raw chips.
 *
 * THE REGISTRY SHIPS EMPTY.  The M0 corpus report proposes a whitelist, but
 * each rule must be added deliberately (Gate G0 follow-up) with its corpus
 * rank and a doc string — `MAX_TIER2_RULES` caps the budget so the tier-2
 * layer never grows into a general C# transpiler.  `Tier2RuleId` is `never`
 * until the first shipped rule introduces a union member, which makes it a
 * compile error to reference rule ids that do not exist.
 *
 * The evaluator is deliberately tiny: first match wins, and the rule's
 * `captures` are substituted into both templates with naive `{name}`
 * replacement (unknown placeholders are left verbatim).
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import type { CwPseudoStep } from '../cwTypes';

/** Union of shipped rule ids — `never` while the registry is empty. */
export type Tier2RuleId = never;

/** Hard budget on the number of shipped tier-2 rules. */
export const MAX_TIER2_RULES = 15;

export interface Tier2Rule {
  id: Tier2RuleId;
  family: 'assign' | 'string' | 'linq' | 'collection' | 'file' | 'datetime' | 'console';
  /** Rank of the rule's bucket in the M0 corpus report (provenance). */
  m0Rank: number;
  /** One-line description of the matched pattern. */
  doc: string;
  /** Return captures when the statement matches, else null. */
  match(stmt: Node, source: string): { captures: Record<string, string> } | null;
  titleTemplate: string;
  textTemplate: string;
}

/** The shipped registry — EMPTY by design (see module header). */
export const TIER2_RULES: readonly Tier2Rule[] = [];

/** Icon per rule family. */
export const TIER2_FAMILY_ICONS: Record<Tier2Rule['family'], string> = {
  assign: 'arrow-right',
  string: 'symbol-string',
  linq: 'filter',
  collection: 'list-ordered',
  file: 'file',
  datetime: 'calendar',
  console: 'terminal'
};

/** Naive `{name}` substitution; unknown placeholders stay verbatim. */
function substitute(template: string, captures: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in captures ? captures[key] : whole
  );
}

/**
 * Evaluate the rules against one leaf statement — first match wins.
 * Returns a `CwPseudoStep` with an EMPTY id (the model builder assigns
 * hierarchical ids in its own pass), or null when nothing matches.
 */
export function applyTier2(
  stmt: Node,
  source: string,
  rules: readonly Tier2Rule[] = TIER2_RULES
): CwPseudoStep | null {
  for (const rule of rules) {
    const result = rule.match(stmt, source);
    if (result === null) continue;
    return {
      id: '',
      span: {
        startLine: stmt.startPosition.row,
        startCol: stmt.startPosition.column,
        endLine: stmt.endPosition.row,
        endCol: stmt.endPosition.column
      },
      type: 'pseudo',
      tier: 2,
      ruleId: rule.id,
      title: substitute(rule.titleTemplate, result.captures),
      text: substitute(rule.textTemplate, result.captures),
      icon: TIER2_FAMILY_ICONS[rule.family]
    };
  }
  return null;
}
