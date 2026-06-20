/**
 * Bucket-signature generator for statements NOT matched by the tier-1
 * matcher. The M0 corpus analysis groups unmatched statements by this
 * signature to pick a transpiler whitelist, so the only hard requirements
 * are: deterministic output, method names verbatim, and countable chains.
 *
 * Signature scheme (max expression depth 2):
 *
 * Heads
 *  - `decl=`        local_declaration_statement (first declarator's value)
 *  - `assign<op> `  expression statement whose expression is an assignment
 *                   (`assign= `, `assign+= `, ...), value = RHS
 *  - `call:`        any other bare expression statement
 *  - `return `      return_statement (bare `return;` → `return`)
 *  - `throw `       throw_statement  (bare `throw;`  → `throw`)
 *  - `yield `       yield_statement  (`yield break;` → `yield`)
 *  - `stmt:<type>`  fallback for all other statement kinds
 *
 * Receiver tokens (chain roots)
 *  - `svc:<id>`     catalog family root — sanity marker, normally pre-matched
 *  - `handle:<id>`  tracked service handle — sanity marker, normally matched
 *  - PascalCase identifiers kept VERBATIM (`File`, `Regex`, `JsonConvert`):
 *    first char uppercase ⇒ verbatim
 *  - predefined types kept verbatim (`string.Join` → `string`)
 *  - other identifiers → `var`; `this` → `this`; anything else → `expr`
 *
 * CHAIN RULE (the one deterministic rule):
 *  A call chain renders as `<root>.<Seg1>.<Seg2>...(<groups>)` where the
 *  dotted segments are ALL member-name links in source order (property
 *  segments included, method names verbatim, indexers and `?.` transparent),
 *  followed by ONE parenthesized list containing each invocation link's arg
 *  shapes in chain order: shapes within a link joined by `,`, non-empty
 *  links joined by `;`, links with zero args contributing nothing. At most
 *  4 shapes total are rendered, then `+` is appended.
 *  Examples: `items.Where(i => i.Ok).ToList()` → `var.Where.ToList(lambda)`;
 *  `items.Where(a).Select(b).ToList()` → `var.Where.Select.ToList(lambda;lambda)`.
 *
 * Arg shapes (terminal): `str`, `num`, `bool`, `null`, `interp`, `var`,
 * `lambda`, `new:<Type>`, `expr`.
 *
 * Expression values (non-invocation RHS) — await/casts/parens unwrapped
 * first: `binop:<op>(value,value)`, `new:<Type>(<shapes>)` at depth 0
 * (bare `new:<Type>` deeper), `prop:<root>.<Path>` (full dotted path, root
 * as receiver token), `index:<root>`, `interp`, `ternary`, literals as
 * their shapes, identifiers → `var`, everything else → `expr`. Composite
 * values nested deeper than depth 2 collapse to `expr`.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import { TIER1_CATALOG, BASE_FAMILY_ID } from './classify/tier1Catalog';
import type { HandleMap } from './classify/handleTracking';
import { unwrapExpression } from './classify/tier1Match';

const MAX_DEPTH = 2;
const MAX_ARG_SHAPES = 4;

const FAMILY_IDS: ReadonlySet<string> = new Set(
  TIER1_CATALOG.map((f) => f.id).filter((id) => id !== BASE_FAMILY_ID)
);

// ---------------------------------------------------------------------------
// Small node helpers
// ---------------------------------------------------------------------------

function firstExpressionChild(node: Node): Node | null {
  return node.namedChildren.find((c) => c.type !== 'comment') ?? null;
}

function methodNameText(nameNode: Node, source: string): string {
  if (nameNode.type === 'generic_name') {
    const id = nameNode.namedChildren.find((c) => c.type === 'identifier');
    if (id !== undefined) return text(id, source);
  }
  return text(nameNode, source);
}

function text(node: Node, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

interface ChainLink {
  /** Member name, verbatim. */
  name: string;
  /** argument_list of the invocation that called this link, if any. */
  argList: Node | null;
}

interface Chain {
  /** Node at the root of the chain (identifier, `this`, predefined_type, ...). */
  base: Node | null;
  /** Links in root-first order. */
  links: ChainLink[];
  /** Args of an invocation whose function had no member name (e.g. `Foo(x)`,
   *  `arr[0](x)`) — for bare calls these belong to the base identifier. */
  danglingArgs: Node | null;
}

/**
 * Walk any member/element/invocation/`?.` chain down to its base.
 * Works whether the outermost node is an invocation (call chain) or a
 * member access (property path).
 */
function walkChain(node: Node, source: string): Chain {
  const reversed: ChainLink[] = [];
  let pendingArgs: Node | null = null;
  let cur: Node | null = node;

  while (cur !== null) {
    switch (cur.type) {
      case 'invocation_expression':
        pendingArgs = cur.childForFieldName('arguments');
        cur = cur.childForFieldName('function');
        break;
      case 'member_access_expression': {
        const name = cur.childForFieldName('name');
        if (name === null) {
          return { base: cur, links: reversed.reverse(), danglingArgs: pendingArgs };
        }
        reversed.push({ name: methodNameText(name, source), argList: pendingArgs });
        pendingArgs = null;
        cur = cur.childForFieldName('expression');
        break;
      }
      case 'element_access_expression':
        // Indexers are transparent in chains.
        cur = cur.childForFieldName('expression');
        break;
      case 'conditional_access_expression': {
        const binding = cur.namedChildren.find(
          (c) => c.type === 'member_binding_expression'
        );
        const name = binding?.childForFieldName('name');
        if (binding === undefined || name === null || name === undefined) {
          return { base: cur, links: reversed.reverse(), danglingArgs: pendingArgs };
        }
        reversed.push({ name: methodNameText(name, source), argList: pendingArgs });
        pendingArgs = null;
        cur = cur.childForFieldName('condition');
        break;
      }
      default:
        return { base: cur, links: reversed.reverse(), danglingArgs: pendingArgs };
    }
  }
  return { base: null, links: reversed.reverse(), danglingArgs: pendingArgs };
}

/** Receiver token for a chain base node. */
function receiverToken(base: Node | null, source: string, handles: HandleMap): string {
  if (base === null) return 'expr';
  if (base.type === 'identifier') {
    const t = text(base, source);
    if (FAMILY_IDS.has(t)) return `svc:${t}`;
    const handleFamily = handles[t];
    if (handleFamily !== undefined) return `handle:${handleFamily}`;
    if (/^[A-Z]/.test(t)) return t;
    return 'var';
  }
  if (base.type === 'this') return 'this';
  if (base.type === 'predefined_type') return text(base, source);
  return 'expr';
}

// ---------------------------------------------------------------------------
// Arg shapes (terminal)
// ---------------------------------------------------------------------------

function typeNameText(typeNode: Node | null, source: string): string {
  if (typeNode === null) return '?';
  return text(typeNode, source).replace(/\s+/g, '');
}

function isNumericLiteral(node: Node): boolean {
  return node.type === 'integer_literal' || node.type === 'real_literal';
}

/** Terminal shape of a single expression (used for invocation args). */
function simpleShape(node: Node, source: string): string | null {
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
    case 'character_literal':
      return 'str';
    case 'integer_literal':
    case 'real_literal':
      return 'num';
    case 'boolean_literal':
      return 'bool';
    case 'null_literal':
      return 'null';
    case 'interpolated_string_expression':
      return 'interp';
    case 'lambda_expression':
    case 'anonymous_method_expression':
      return 'lambda';
    case 'identifier':
      return 'var';
    case 'declaration_expression': // `out var x`
      return 'var';
    case 'object_creation_expression':
      return `new:${typeNameText(node.childForFieldName('type'), source)}`;
    case 'implicit_object_creation_expression':
      return 'new:?';
    case 'prefix_unary_expression': {
      // `-1` / `+1` keep the numeric shape.
      const inner = firstExpressionChild(node);
      if (inner !== null && isNumericLiteral(inner)) return 'num';
      return null;
    }
    default:
      return null;
  }
}

/** Shape of one `argument` node. */
function argShape(arg: Node, source: string): string {
  const nameField = arg.childForFieldName('name');
  const values = arg.namedChildren.filter(
    (c) => (nameField === null || c.id !== nameField.id) && c.type !== 'comment'
  );
  const value = values.length > 0 ? values[values.length - 1] : null;
  if (value === null) return 'expr';
  const unwrapped = unwrapExpression(value);
  return simpleShape(unwrapped, source) ?? 'expr';
}

// ---------------------------------------------------------------------------
// Chain + value rendering
// ---------------------------------------------------------------------------

/**
 * Render the parenthesized arg-group list for a chain (see CHAIN RULE in
 * the module header). Always returns parens, possibly empty: `()`.
 */
function renderArgGroups(chain: Chain, source: string): string {
  const groupSources: Node[] = [];
  for (const link of chain.links) {
    if (link.argList !== null) groupSources.push(link.argList);
  }
  if (chain.danglingArgs !== null) groupSources.unshift(chain.danglingArgs);

  const groups: string[] = [];
  let total = 0;
  let truncated = false;
  for (const argList of groupSources) {
    const args = argList.namedChildren.filter((c) => c.type === 'argument');
    if (args.length === 0) continue;
    const shapes: string[] = [];
    for (const arg of args) {
      if (total >= MAX_ARG_SHAPES) {
        truncated = true;
        break;
      }
      shapes.push(argShape(arg, source));
      total += 1;
    }
    if (shapes.length > 0) groups.push(shapes.join(','));
    if (truncated) break;
  }
  return `(${groups.join(';')}${truncated ? '+' : ''})`;
}

/** Render a call chain: `<root>.<segments>(<groups>)`. */
function chainSig(invocation: Node, source: string, handles: HandleMap): string {
  const chain = walkChain(invocation, source);

  // Bare call (`Foo(1)`, `Foo<T>(1)`): the base identifier IS the method.
  if (
    chain.links.length === 0 &&
    chain.base !== null &&
    (chain.base.type === 'identifier' || chain.base.type === 'generic_name')
  ) {
    const name = methodNameText(chain.base, source);
    return name + renderArgGroups(chain, source);
  }

  const parts = [
    receiverToken(chain.base, source, handles),
    ...chain.links.map((l) => l.name)
  ];
  return parts.join('.') + renderArgGroups(chain, source);
}

/** Render a property-read path: `prop:<root>.<Path>`. Call parens omitted. */
function propSig(node: Node, source: string, handles: HandleMap): string {
  const chain = walkChain(node, source);
  const parts = [
    receiverToken(chain.base, source, handles),
    ...chain.links.map((l) => l.name)
  ];
  return `prop:${parts.join('.')}`;
}

const COMPOSITE_TYPES: ReadonlySet<string> = new Set([
  'invocation_expression',
  'binary_expression',
  'object_creation_expression',
  'implicit_object_creation_expression',
  'member_access_expression',
  'element_access_expression',
  'conditional_access_expression',
  'conditional_expression',
  'assignment_expression'
]);

/**
 * Render an expression value. `depth` 0 is the statement's own value;
 * binop operands recurse at depth+1; composites beyond MAX_DEPTH collapse
 * to `expr`.
 */
function valueSig(
  node: Node,
  source: string,
  handles: HandleMap,
  depth: number
): string {
  const expr = unwrapExpression(node);

  if (depth > MAX_DEPTH && COMPOSITE_TYPES.has(expr.type)) {
    return 'expr';
  }

  const simple = simpleShape(expr, source);

  switch (expr.type) {
    case 'invocation_expression':
      return chainSig(expr, source, handles);
    case 'binary_expression': {
      const op = expr.childForFieldName('operator');
      const left = expr.childForFieldName('left');
      const right = expr.childForFieldName('right');
      if (op === null || left === null || right === null) return 'expr';
      return `binop:${op.text}(${valueSig(left, source, handles, depth + 1)},${valueSig(right, source, handles, depth + 1)})`;
    }
    case 'object_creation_expression': {
      const typeName = typeNameText(expr.childForFieldName('type'), source);
      if (depth === 0) {
        const argList = expr.childForFieldName('arguments');
        const chain: Chain = { base: null, links: [], danglingArgs: argList };
        return `new:${typeName}${renderArgGroups(chain, source)}`;
      }
      return `new:${typeName}`;
    }
    case 'member_access_expression':
    case 'conditional_access_expression':
      return propSig(expr, source, handles);
    case 'element_access_expression': {
      const target = expr.childForFieldName('expression');
      const chain = target !== null ? walkChain(target, source) : null;
      return `index:${receiverToken(chain !== null ? chain.base : null, source, handles)}`;
    }
    case 'conditional_expression':
      return 'ternary';
    default:
      return simple ?? 'expr';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize one unmatched statement to its bucket signature.
 * `source` must be the exact text the statement's tree was parsed from.
 */
export function normalizeStatement(
  stmt: Node,
  source: string,
  handles: HandleMap
): string {
  switch (stmt.type) {
    case 'local_declaration_statement': {
      const declaration = stmt.namedChildren.find(
        (c) => c.type === 'variable_declaration'
      );
      const declarator = declaration?.namedChildren.find(
        (c) => c.type === 'variable_declarator'
      );
      if (declarator === undefined) return 'decl=';
      const name = declarator.childForFieldName('name');
      const candidates = declarator.namedChildren.filter(
        (c) =>
          (name === null || c.id !== name.id) &&
          c.type !== 'bracketed_argument_list' &&
          c.type !== 'tuple_pattern' &&
          c.type !== 'comment'
      );
      const initializer =
        candidates.length > 0 ? candidates[candidates.length - 1] : null;
      if (initializer === null) return 'decl=';
      return `decl=${valueSig(initializer, source, handles, 0)}`;
    }
    case 'expression_statement': {
      const inner = firstExpressionChild(stmt);
      if (inner === null) return 'call:expr';
      if (inner.type === 'assignment_expression') {
        const op = inner.childForFieldName('operator');
        const right = inner.childForFieldName('right');
        const opText = op !== null ? op.text : '=';
        const rhs =
          right !== null ? valueSig(right, source, handles, 0) : 'expr';
        return `assign${opText} ${rhs}`;
      }
      return `call:${valueSig(inner, source, handles, 0)}`;
    }
    case 'return_statement': {
      const value = firstExpressionChild(stmt);
      return value === null
        ? 'return'
        : `return ${valueSig(value, source, handles, 0)}`;
    }
    case 'throw_statement': {
      const value = firstExpressionChild(stmt);
      return value === null
        ? 'throw'
        : `throw ${valueSig(value, source, handles, 0)}`;
    }
    case 'yield_statement': {
      const value = firstExpressionChild(stmt);
      return value === null
        ? 'yield'
        : `yield ${valueSig(value, source, handles, 0)}`;
    }
    default:
      return `stmt:${stmt.type}`;
  }
}
