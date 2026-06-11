/**
 * Tier-2 "transpiler" rule engine: a small whitelist of statement patterns
 * rendered as friendly pseudo-steps (`CwPseudoStep`) instead of raw chips.
 *
 * Rules are added deliberately (Gate G0 follow-up) with their corpus rank,
 * a doc string, and fixture evidence under
 * `tests/fixtures/codedWorkflow/tier2/<id>/` — `MAX_TIER2_RULES` caps the
 * budget so the tier-2 layer never grows into a general C# transpiler.
 * `Tier2RuleId` is the union of shipped ids, which makes it a compile error
 * to reference rule ids that do not exist.  The manifest
 * (`docs/tier2-rules.md`) is kept in parity by tier2Cap.test.ts.
 *
 * The evaluator is deliberately tiny: first match wins, and the rule's
 * `captures` are substituted into both templates with naive `{name}`
 * replacement (unknown placeholders are left verbatim).
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import type { CwPseudoStep } from '../cwTypes';

/** Union of shipped rule ids. */
export type Tier2RuleId = 'assign-from-call';

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

// ---------------------------------------------------------------------------
// Shared AST helpers for the floor rules (pure syntax — no type inference)
// ---------------------------------------------------------------------------

/** Exact source slice of a node. */
function sliceOf(node: Node, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

/** First named child that is not a comment. */
function firstNonComment(node: Node): Node | null {
  return node.namedChildren.find((c) => c.type !== 'comment') ?? null;
}

/** Strip parentheses and casts — deliberately NOT `await` (await stays tier-3). */
function unwrapParensCasts(node: Node): Node {
  let cur = node;
  for (;;) {
    if (cur.type === 'parenthesized_expression') {
      const inner = firstNonComment(cur);
      if (inner === null) return cur;
      cur = inner;
    } else if (cur.type === 'cast_expression') {
      const value = cur.childForFieldName('value');
      if (value === null) return cur;
      cur = value;
    } else {
      return cur;
    }
  }
}

/** True when the subtree (including `node` itself) contains any of `types`. */
function containsType(node: Node, types: ReadonlySet<string>): boolean {
  if (types.has(node.type)) return true;
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && containsType(child, types)) return true;
  }
  return false;
}

/** Node types whose presence anywhere in an RHS keeps a statement tier-3. */
const ESCAPE_HATCH_TYPES: ReadonlySet<string> = new Set([
  'await_expression',
  'lambda_expression',
  'anonymous_method_expression',
  'query_expression'
]);

/**
 * A statement's single bound value: `var x = <value>;` / `T x = <value>;`
 * (exactly ONE declarator), `x = <value>;`, or `x += <value>;`.
 * Returns null for anything else (multi-declarators, other compound ops,
 * non-identifier assignment targets, bare expression statements).
 */
interface BoundValue {
  /** The bound variable name, exact source. */
  binding: string;
  op: '=' | '+=';
  value: Node;
  context: 'declaration' | 'assignment';
}

function boundValueOf(stmt: Node): BoundValue | null {
  if (stmt.type === 'local_declaration_statement') {
    const declaration = stmt.namedChildren.find((c) => c.type === 'variable_declaration');
    if (declaration === undefined) return null;
    const declarators = declaration.namedChildren.filter(
      (c) => c.type === 'variable_declarator'
    );
    if (declarators.length !== 1) return null;
    const declarator = declarators[0];
    const name = declarator.childForFieldName('name');
    if (name === null) return null;
    const candidates = declarator.namedChildren.filter(
      (c) =>
        c.id !== name.id &&
        c.type !== 'bracketed_argument_list' &&
        c.type !== 'tuple_pattern' &&
        c.type !== 'comment'
    );
    if (candidates.length === 0) return null;
    return {
      binding: name.text,
      op: '=',
      value: candidates[candidates.length - 1],
      context: 'declaration'
    };
  }
  if (stmt.type === 'expression_statement') {
    const inner = firstNonComment(stmt);
    if (inner === null || inner.type !== 'assignment_expression') return null;
    const op = inner.childForFieldName('operator');
    if (op === null || (op.text !== '=' && op.text !== '+=')) return null;
    const left = inner.childForFieldName('left');
    const right = inner.childForFieldName('right');
    if (left === null || right === null || left.type !== 'identifier') return null;
    return { binding: left.text, op: op.text, value: right, context: 'assignment' };
  }
  return null;
}

/**
 * Walk a pure `member_access_expression` chain (no calls, no indexers, no
 * `?.`) down to its root.  Returns the root node when it is an identifier or
 * a predefined type (static type name like `string`), else null.
 */
function memberChainRoot(fn: Node): Node | null {
  let cur = fn;
  while (cur.type === 'member_access_expression') {
    const expr = cur.childForFieldName('expression');
    if (expr === null) return null;
    cur = expr;
  }
  return cur.type === 'identifier' || cur.type === 'predefined_type' ? cur : null;
}

// ---------------------------------------------------------------------------
// Rule: assign-from-call (assign, M0 rank 8)
// ---------------------------------------------------------------------------

/**
 * Matchers of MORE SPECIFIC floor rules that `assign-from-call` (the most
 * general rule) yields to, so the generic "Assign" card never shadows a
 * specialized card.  Grown as each specific rule ships (T3.2a); the registry
 * itself stays sorted by m0Rank, so this guard — not array order — encodes
 * the specificity dispatch.
 */
const SPECIFIC_FLOOR_MATCHERS: ReadonlyArray<
  (stmt: Node, source: string) => unknown
> = [];

function matchAssignFromCall(
  stmt: Node,
  source: string
): { captures: Record<string, string> } | null {
  const bound = boundValueOf(stmt);
  if (bound === null || bound.op !== '=') return null;
  const value = unwrapParensCasts(bound.value);
  if (value.type !== 'invocation_expression') return null;
  // No await/lambda/query anywhere in the RHS — those are not "one call".
  if (containsType(value, ESCAPE_HATCH_TYPES)) return null;
  const fn = value.childForFieldName('function');
  if (fn === null) return null;
  // Function must be a bare identifier (`Foo(...)`) or a pure member-access
  // chain rooted at an identifier / static type name (`Obj.Foo(...)`,
  // `TestHelpers.Build(...)`).  Expression-rooted chains
  // (`new Random().Next(...)`, `a.B().C(...)`) stay tier-3.
  if (fn.type !== 'identifier' && memberChainRoot(fn) === null) return null;
  for (const specific of SPECIFIC_FLOOR_MATCHERS) {
    if (specific(stmt, source) !== null) return null;
  }
  return { captures: { x: bound.binding, call: sliceOf(value, source) } };
}

const ASSIGN_FROM_CALL: Tier2Rule = {
  id: 'assign-from-call',
  family: 'assign',
  m0Rank: 8,
  doc:
    'Assign from one call: `var x = Foo(args)` / `x = Obj.Foo(args)` where the ' +
    'RHS (parens/casts unwrapped, await NOT unwrapped) is exactly one invocation ' +
    'whose function is an identifier or a pure member-access chain rooted at an ' +
    'identifier/static type name, with no await/lambda/query anywhere in the RHS. ' +
    'Yields to the more specific floor rules via SPECIFIC_FLOOR_MATCHERS.',
  match: matchAssignFromCall,
  titleTemplate: 'Assign',
  textTemplate: '{x} = {call}'
};

/** The shipped registry — sorted ascending by m0Rank. */
export const TIER2_RULES: readonly Tier2Rule[] = [ASSIGN_FROM_CALL];

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
