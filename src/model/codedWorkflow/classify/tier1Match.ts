/**
 * Tier-1 matcher: decides whether a single statement is a recognized UiPath
 * service call (tier-1) and, if so, which family/member it belongs to.
 *
 * Matching algorithm (per spec):
 *  1. Unwrap `expression_statement` / `local_declaration_statement` /
 *     `return_statement` to the candidate expression; unwrap
 *     `await_expression`, parens, casts, and `as`-expressions (M0 lever L3);
 *     capture `resultBinding` when the call sits behind `var x = ...` or
 *     `x = ...`.
 *  2. The candidate must be an `invocation_expression` — EXCEPT the M0
 *     lever L2 fallback: a bare element-access read on a tracked handle used
 *     as a declaration/assignment initializer matches as method `[indexer]`.
 *  3. Walk the `member_access_expression` / `element_access_expression`
 *     chain (element access is walked THROUGH — `wb.Sheet["S1"].ReadRange()`
 *     passes through the indexer) down to the ROOT identifier, skipping a
 *     leading `this.`. Simple `?.` chains (`x?.Foo()`) are walked like `.`.
 *  4. Resolve the root: catalog family id → that family; tracked handle →
 *     its family; bare invocation (function is a plain identifier) whose
 *     name is a `_base` entry method → `_base`; otherwise no match.
 *  5. `method` is the last name segment; `catalogEntry` is the exact member
 *     match when the family lists it. An unknown member of a known family is
 *     STILL a tier-1 match (entry simply absent → generic card).
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import {
  TIER1_CATALOG,
  BASE_FAMILY_ID,
  type CatalogEntry,
  type ServiceFamily
} from './tier1Catalog';
import type { HandleMap } from './handleTracking';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Tier1Match {
  familyId: string;
  familyDisplayName: string;
  /** Family icon id (entry-level overrides are applied by the consumer). */
  familyIcon: string;
  /** Wildcard family title template (`{method}` placeholder), when present. */
  wildcardTitleTemplate?: string;
  method: string;
  /** Present only when the family explicitly catalogs this member. */
  catalogEntry?: CatalogEntry;
  /** Variable receiving the result (`var x = ...` or `x = ...`). */
  resultBinding?: string;
  /**
   * The matched `invocation_expression` node — lets the consumer extract arg
   * summaries without re-walking the statement.  Absent for indexer matches.
   * NOT serializable; never crosses the postMessage boundary.
   */
  invocation?: Node;
  /**
   * For `[indexer]` matches (M0 lever L2): the `bracketed_argument_list`
   * holding the key expression.  NOT serializable.
   */
  indexerSubscript?: Node;
}

// ---------------------------------------------------------------------------
// Catalog index (consumers index the data-only catalog themselves)
// ---------------------------------------------------------------------------

const FAMILY_BY_ID: ReadonlyMap<string, ServiceFamily> = new Map(
  TIER1_CATALOG.map((f) => [f.id, f])
);

// ---------------------------------------------------------------------------
// Expression helpers (shared with handleTracking / normalizeStatement)
// ---------------------------------------------------------------------------

/** First named child that is not a comment. */
function firstExpressionChild(node: Node): Node | null {
  return node.namedChildren.find((c) => c.type !== 'comment') ?? null;
}

/**
 * Strip `await`, parentheses, casts, and `as`-expressions off an expression.
 * `await (T)(x.Foo())` → the inner `invocation_expression`;
 * `x.Foo() as string` likewise (M0 lever L3).
 */
export function unwrapExpression(node: Node): Node {
  let cur = node;
  for (;;) {
    if (
      cur.type === 'await_expression' ||
      cur.type === 'parenthesized_expression'
    ) {
      const inner = firstExpressionChild(cur);
      if (inner === null) return cur;
      cur = inner;
    } else if (cur.type === 'cast_expression') {
      const value = cur.childForFieldName('value');
      if (value === null) return cur;
      cur = value;
    } else if (cur.type === 'as_expression') {
      const left = cur.childForFieldName('left');
      if (left === null) return cur;
      cur = left;
    } else {
      return cur;
    }
  }
}

/** Method name text, stripping type arguments off `generic_name` nodes. */
function methodNameText(nameNode: Node): string {
  if (nameNode.type === 'generic_name') {
    const id = nameNode.namedChildren.find((c) => c.type === 'identifier');
    return id !== undefined ? id.text : nameNode.text;
  }
  return nameNode.text;
}

/** Result of walking an invocation's receiver chain down to its root. */
type ChainWalk =
  | { kind: 'bare'; method: string }
  | { kind: 'rooted'; rootText: string; method: string };

/** A subscript argument list is trivial when every key is a literal or bare identifier. */
function isTrivialSubscript(subscript: Node | null): boolean {
  if (subscript === null) return true;
  for (const arg of subscript.namedChildren) {
    if (arg.type !== 'argument') continue;
    const value = arg.namedChildren.find((c) => c.type !== 'comment') ?? null;
    if (value === null) return false;
    if (!LITERAL_NODE_TYPES.has(value.type) && value.type !== 'identifier') {
      return false;
    }
  }
  return true;
}

/** Literal node types accepted as trivial element-access keys. */
const LITERAL_NODE_TYPES: ReadonlySet<string> = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'character_literal',
  'integer_literal',
  'real_literal',
  'boolean_literal',
  'null_literal'
]);

/**
 * Walk from an `invocation_expression` down to the root of its receiver
 * chain. Element access and chained invocations are transparent; a leading
 * `this.` is skipped (so `this.Log(...)` is a bare call and
 * `this.system.GetAsset(...)` roots at `system`).
 * Returns null when the chain has an unresolvable shape.
 *
 * HONESTY: only the OUTERMOST invocation's arguments are rendered on the card.
 * An INTERMEDIATE call traversed in the chain (`wb.GetSheet(BuildName(idx++))
 * .ReadRange()`) would hide `GetSheet(...)` and its side-effecting argument, so
 * a traversed intermediate invocation with a NON-EMPTY argument list returns
 * null (→ the statement falls to a tier-3 chip).  Likewise a traversed
 * element-access subscript that is NON-TRIVIAL (anything other than a literal
 * or bare identifier) returns null.  A zero-arg intermediate call and a
 * literal/identifier subscript stay transparent.
 */
function walkInvocationChain(invocation: Node): ChainWalk | null {
  /** name segments, outermost (the called method) first */
  const segments: string[] = [];
  let cur: Node | null = invocation;
  /** False until we step past the outermost invocation (whose args ARE shown). */
  let sawOutermost = false;

  while (cur !== null) {
    switch (cur.type) {
      case 'invocation_expression': {
        if (sawOutermost) {
          // Intermediate call: its args are NOT rendered, so a non-empty arg
          // list would hide work. Demote the whole statement to a chip.
          const argList = cur.childForFieldName('arguments');
          const hasArgs =
            argList !== null && argList.namedChildren.some((c) => c.type === 'argument');
          if (hasArgs) return null;
        }
        sawOutermost = true;
        cur = cur.childForFieldName('function');
        break;
      }
      case 'member_access_expression': {
        const name = cur.childForFieldName('name');
        if (name === null) return null;
        segments.push(methodNameText(name));
        cur = cur.childForFieldName('expression');
        break;
      }
      case 'element_access_expression':
        // Indexers are transparent ONLY when the key is trivial: a non-trivial
        // subscript (a call / arithmetic) hides work, so demote to a chip.
        if (!isTrivialSubscript(cur.childForFieldName('subscript'))) return null;
        cur = cur.childForFieldName('expression');
        break;
      case 'conditional_access_expression': {
        // Simple `x?.Foo()` form: member binding gives the name, condition
        // is the receiver. Other binding shapes are unresolvable.
        const binding = cur.namedChildren.find(
          (c) => c.type === 'member_binding_expression'
        );
        if (binding === undefined) return null;
        const name = binding.childForFieldName('name');
        if (name === null) return null;
        segments.push(methodNameText(name));
        cur = cur.childForFieldName('condition');
        break;
      }
      case 'identifier': {
        if (segments.length === 0) {
          // Bare invocation: `Log("x")`.
          return { kind: 'bare', method: cur.text };
        }
        return {
          kind: 'rooted',
          rootText: cur.text,
          method: segments[0]
        };
      }
      case 'generic_name': {
        if (segments.length === 0) {
          // Bare generic invocation: `Foo<T>("x")`.
          return { kind: 'bare', method: methodNameText(cur) };
        }
        return null;
      }
      case 'this': {
        // Skip the leading `this.`: the innermost collected segment becomes
        // the root identifier; with a single segment it is a bare call.
        if (segments.length === 0) return null;
        if (segments.length === 1) {
          return { kind: 'bare', method: segments[0] };
        }
        const rootText = segments[segments.length - 1];
        return { kind: 'rooted', rootText, method: segments[0] };
      }
      default:
        // predefined_type (string.Join), qualified names, expressions, ...
        return null;
    }
  }
  return null;
}

/** Resolve a root identifier to a family id via the catalog or handle map. */
function resolveReceiver(rootText: string, handles: HandleMap): string | null {
  if (rootText !== BASE_FAMILY_ID && FAMILY_BY_ID.has(rootText)) {
    return rootText;
  }
  const viaHandle = handles[rootText];
  if (viaHandle !== undefined && FAMILY_BY_ID.has(viaHandle)) {
    return viaHandle;
  }
  return null;
}

/**
 * Resolve the family of a receiver-rooted invocation expression (after
 * unwrapping await/parens/casts). Bare base-class calls do NOT resolve here —
 * they produce no service handle. Used by handle tracking.
 */
export function resolveInvocationFamily(
  expr: Node,
  handles: HandleMap
): string | null {
  const inv = unwrapExpression(expr);
  if (inv.type !== 'invocation_expression') return null;
  const walk = walkInvocationChain(inv);
  if (walk === null || walk.kind !== 'rooted') return null;
  return resolveReceiver(walk.rootText, handles);
}

// ---------------------------------------------------------------------------
// Statement unwrapping
// ---------------------------------------------------------------------------

interface UnwrappedStatement {
  expression: Node | null;
  resultBinding?: string;
  /** Syntactic position the expression was found in. */
  context: 'expression' | 'declaration' | 'assignment' | 'return';
}

/** Initializer expression of a `variable_declarator`, or null. */
function declaratorInitializer(declarator: Node): Node | null {
  const name = declarator.childForFieldName('name');
  const candidates = declarator.namedChildren.filter(
    (c) =>
      (name === null || c.id !== name.id) &&
      c.type !== 'bracketed_argument_list' &&
      c.type !== 'tuple_pattern' &&
      c.type !== 'comment'
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function unwrapStatement(stmt: Node): UnwrappedStatement {
  switch (stmt.type) {
    case 'expression_statement': {
      const inner = firstExpressionChild(stmt);
      if (inner === null) return { expression: null, context: 'expression' };
      if (inner.type === 'assignment_expression') {
        const op = inner.childForFieldName('operator');
        if (op === null || op.text !== '=') {
          // Compound assignments are not call statements.
          return { expression: null, context: 'assignment' };
        }
        const left = inner.childForFieldName('left');
        const right = inner.childForFieldName('right');
        return {
          expression: right,
          resultBinding:
            left !== null && left.type === 'identifier' ? left.text : undefined,
          context: 'assignment'
        };
      }
      return { expression: inner, context: 'expression' };
    }
    case 'local_declaration_statement': {
      const declaration = stmt.namedChildren.find(
        (c) => c.type === 'variable_declaration'
      );
      const declarator = declaration?.namedChildren.find(
        (c) => c.type === 'variable_declarator'
      );
      if (declarator === undefined) return { expression: null, context: 'declaration' };
      const name = declarator.childForFieldName('name');
      return {
        expression: declaratorInitializer(declarator),
        resultBinding: name !== null ? name.text : undefined,
        context: 'declaration'
      };
    }
    case 'return_statement':
      return { expression: firstExpressionChild(stmt), context: 'return' };
    default:
      return { expression: null, context: 'expression' };
  }
}

// ---------------------------------------------------------------------------
// Public matcher
// ---------------------------------------------------------------------------

/** Assemble a Tier1Match from a resolved family + member. */
function familyMatch(
  family: ServiceFamily,
  method: string,
  resultBinding: string | undefined,
  invocation: Node | undefined
): Tier1Match {
  return {
    familyId: family.id,
    familyDisplayName: family.displayName,
    familyIcon: family.icon,
    ...(family.wildcardTitleTemplate !== undefined
      ? { wildcardTitleTemplate: family.wildcardTitleTemplate }
      : {}),
    method,
    catalogEntry: family.entries.find((e) => e.method === method),
    resultBinding,
    invocation
  };
}

/**
 * Match a bare EXPRESSION (already detached from its statement) against the
 * tier-1 catalog — used for `using`-statement resource initializers and as
 * the core of `matchTier1`.  Unwraps await/parens/casts/`as` itself.
 */
export function matchTier1Expression(
  expression: Node,
  handles: HandleMap,
  resultBinding?: string
): Tier1Match | null {
  const inv = unwrapExpression(expression);
  if (inv.type !== 'invocation_expression') return null;

  const walk = walkInvocationChain(inv);
  if (walk === null) return null;

  if (walk.kind === 'bare') {
    const baseFamily = FAMILY_BY_ID.get(BASE_FAMILY_ID);
    if (baseFamily === undefined) return null;
    const entry = baseFamily.entries.find((e) => e.method === walk.method);
    if (entry === undefined) return null; // bare helper call, not a base API
    return familyMatch(baseFamily, walk.method, resultBinding, inv);
  }

  const familyId = resolveReceiver(walk.rootText, handles);
  if (familyId === null) return null;
  const family = FAMILY_BY_ID.get(familyId);
  if (family === undefined) return null;
  return familyMatch(family, walk.method, resultBinding, inv);
}

/**
 * M0 lever L2: a bare element-access READ on a tracked handle used as a
 * declaration/assignment initializer (`string c = address["Country"];`)
 * becomes a generic `[indexer]` tier-1 match on the handle's family.
 */
function matchIndexerRead(
  expression: Node,
  handles: HandleMap,
  resultBinding: string | undefined
): Tier1Match | null {
  const access = unwrapExpression(expression);
  if (access.type !== 'element_access_expression') return null;
  const receiver = access.childForFieldName('expression');
  if (receiver === null || receiver.type !== 'identifier') return null;
  const familyId = handles[receiver.text];
  if (familyId === undefined) return null;
  const family = FAMILY_BY_ID.get(familyId);
  if (family === undefined) return null;
  const subscript = access.childForFieldName('subscript');
  return {
    familyId: family.id,
    familyDisplayName: family.displayName,
    familyIcon: family.icon,
    method: '[indexer]',
    resultBinding,
    ...(subscript !== null ? { indexerSubscript: subscript } : {})
  };
}

/**
 * Match one statement against the tier-1 catalog.
 * Returns null when the statement is not a recognized service call.
 */
export function matchTier1(stmt: Node, handles: HandleMap): Tier1Match | null {
  const { expression, resultBinding, context } = unwrapStatement(stmt);
  if (expression === null) return null;

  const call = matchTier1Expression(expression, handles, resultBinding);
  if (call !== null) return call;

  if (context === 'declaration' || context === 'assignment') {
    return matchIndexerRead(expression, handles, resultBinding);
  }
  return null;
}
