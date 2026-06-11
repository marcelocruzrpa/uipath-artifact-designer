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
export type Tier2RuleId =
  | 'assign-from-call'
  | 'string-op'
  | 'linq-single-chain'
  | 'file-op'
  | 'datetime-arith';

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
// Rule: linq-single-chain (linq, m0Rank 101 — pure floor)
// ---------------------------------------------------------------------------

/** Whitelisted chain links: lambda-taking ops and zero-arg terminals. */
const LINQ_LAMBDA_LINKS: ReadonlySet<string> = new Set(['Where', 'Select', 'Sum']);
const LINQ_BARE_LINKS: ReadonlySet<string> = new Set([
  'Count',
  'First',
  'FirstOrDefault',
  'ToList',
  'ToArray'
]);
const LINQ_AGGREGATES: ReadonlySet<string> = new Set([
  'Sum',
  'Count',
  'First',
  'FirstOrDefault'
]);
const LINQ_MAX_LINKS = 3;

interface LinqLink {
  name: string;
  /** Exact source of the lambda body — absent on bare links. */
  body?: string;
}

/**
 * Work a linq lambda body must not hide: nested calls and allocations
 * (`new T(...)`, target-typed `new(...)`) are real actions, so a body
 * containing one stays tier-3.
 */
const LAMBDA_BODY_HIDDEN_WORK: ReadonlySet<string> = new Set([
  'invocation_expression',
  'object_creation_expression',
  'implicit_object_creation_expression'
]);

/**
 * A single-param, expression-bodied lambda with no nested call, object
 * creation, or await — the only lambda shape the linq rule accepts.
 * Returns the body node or null.
 */
function simpleLambdaBody(node: Node): Node | null {
  if (node.type !== 'lambda_expression') return null;
  const params = node.childForFieldName('parameters');
  if (params === null) return null;
  if (params.type !== 'implicit_parameter') {
    if (params.type !== 'parameter_list') return null;
    const named = params.namedChildren.filter((c) => c.type === 'parameter');
    if (named.length !== 1) return null;
  }
  const body = node.childForFieldName('body');
  if (body === null || body.type === 'block') return null;
  if (containsType(body, ESCAPE_HATCH_TYPES)) return null;
  if (containsType(body, LAMBDA_BODY_HIDDEN_WORK)) return null;
  return body;
}

/** True when `node` is an identifier or a pure identifier property path. */
function isIdentifierPath(node: Node): boolean {
  if (node.type === 'identifier') return true;
  if (node.type !== 'member_access_expression') return false;
  const expr = node.childForFieldName('expression');
  return expr !== null && isIdentifierPath(expr);
}

function matchLinqSingleChain(
  stmt: Node,
  source: string
): { captures: Record<string, string> } | null {
  const bound = boundValueOf(stmt);
  if (bound === null || bound.op !== '=') return null;

  // Decompose `src.L1(...).L2(...)...` outermost-first into links + source.
  const reversed: LinqLink[] = [];
  let cur: Node = bound.value;
  let src: Node | null = null;
  for (;;) {
    if (cur.type !== 'invocation_expression') return null;
    const fn = cur.childForFieldName('function');
    if (fn === null || fn.type !== 'member_access_expression') return null;
    const name = fn.childForFieldName('name');
    const recv = fn.childForFieldName('expression');
    if (name === null || name.type !== 'identifier' || recv === null) return null;
    const args = argumentValues(cur.childForFieldName('arguments'));
    if (args === null) return null;
    if (LINQ_LAMBDA_LINKS.has(name.text)) {
      if (args.length !== 1) return null;
      const body = simpleLambdaBody(args[0]);
      if (body === null) return null;
      reversed.push({ name: name.text, body: sliceOf(body, source) });
    } else if (LINQ_BARE_LINKS.has(name.text)) {
      if (args.length !== 0) return null;
      reversed.push({ name: name.text });
    } else {
      return null;
    }
    if (reversed.length > LINQ_MAX_LINKS) return null;
    if (recv.type === 'invocation_expression') {
      cur = recv;
      continue;
    }
    if (!isIdentifierPath(recv)) return null;
    src = recv;
    break;
  }
  const links = reversed.reverse();

  // Title by dominance: the last aggregate wins; else Where > Select > the
  // terminal conversion (named for what it actually produces).
  let title = links[links.length - 1].name === 'ToArray' ? 'To array' : 'To list';
  const lastAggregate = [...links].reverse().find((l) => LINQ_AGGREGATES.has(l.name));
  if (lastAggregate !== undefined) {
    title =
      lastAggregate.name === 'Sum'
        ? 'Sum'
        : lastAggregate.name === 'Count'
          ? 'Count'
          : 'Take first';
  } else if (links.some((l) => l.name === 'Where')) {
    title = 'Filter';
  } else if (links.some((l) => l.name === 'Select')) {
    title = 'Transform';
  }

  const segments = links.map((link) => {
    switch (link.name) {
      case 'Where':
        return ` → where ${link.body}`;
      case 'Select':
        return ` → select ${link.body}`;
      case 'Sum':
        return ` → sum of ${link.body}`;
      case 'Count':
        return ' → count';
      case 'First':
        return ' → first';
      case 'FirstOrDefault':
        return ' → first or default';
      case 'ToArray':
        return ' → to array';
      default: // ToList
        return ' → to list';
    }
  });

  return {
    captures: {
      title,
      x: bound.binding,
      chain: `${sliceOf(src, source)}${segments.join('')}`
    }
  };
}

const LINQ_SINGLE_CHAIN: Tier2Rule = {
  id: 'linq-single-chain',
  family: 'linq',
  m0Rank: 101,
  doc:
    'Short LINQ chain bound to a variable: <=3 links from {Where, Select, Sum, ' +
    'Count, First, FirstOrDefault, ToList, ToArray} rooted at an identifier or ' +
    'property path. Where/Select/Sum take exactly one single-param ' +
    'expression-bodied lambda with no nested call, object creation, or await; ' +
    'Count/First/FirstOrDefault/ToList/ToArray take zero args (predicate ' +
    'overloads stay tier-3). Title by dominance: last aggregate > Where ' +
    '(Filter) > Select (Transform) > To list / To array. FirstOrDefault links ' +
    'render "first or default"; ToArray renders "to array".',
  match: matchLinqSingleChain,
  titleTemplate: '{title}',
  textTemplate: '{x} = {chain}'
};

// ---------------------------------------------------------------------------
// Rule: file-op (file, m0Rank 102 — pure floor)
// ---------------------------------------------------------------------------

/** `Receiver.Method` whitelist with card titles (manifest row 4). */
const FILE_OP_TITLES: ReadonlyMap<string, string> = new Map([
  ['File.ReadAllText', 'Read file'],
  ['File.ReadAllLines', 'Read file lines'],
  ['File.WriteAllText', 'Write file'],
  ['File.AppendAllText', 'Append to file'],
  ['File.Copy', 'Copy file'],
  ['File.Move', 'Move file'],
  ['File.Delete', 'Delete file'],
  ['File.Exists', 'File exists?'],
  ['Directory.CreateDirectory', 'Create folder'],
  ['Directory.Delete', 'Delete folder'],
  ['Directory.Exists', 'Folder exists?'],
  ['Directory.GetFiles', 'List files'],
  ['Path.Combine', 'Combine path'],
  ['Path.GetFileName', 'File name of path'],
  ['Path.GetDirectoryName', 'Folder of path']
]);

/**
 * Allowed argument counts per whitelisted method as `[min, max]` — any call
 * outside the range stays tier-3.  The ranges are exactly the arities whose
 * text shapes render EVERY argument (the hard fence: a card never drops an
 * argument); encoding / SearchOption / recursive-flag overloads are
 * deliberately out of range because their extra arg would change semantics
 * the card title does not carry.
 */
const FILE_OP_ARITIES: ReadonlyMap<string, readonly [number, number]> = new Map<
  string,
  readonly [number, number]
>([
  ['File.ReadAllText', [1, 1]],
  ['File.ReadAllLines', [1, 1]],
  ['File.WriteAllText', [2, 2]],
  ['File.AppendAllText', [2, 2]],
  ['File.Copy', [2, 3]],
  ['File.Move', [2, 2]],
  ['File.Delete', [1, 1]],
  ['File.Exists', [1, 1]],
  ['Directory.CreateDirectory', [1, 1]],
  ['Directory.Delete', [1, 1]],
  ['Directory.Exists', [1, 1]],
  ['Directory.GetFiles', [1, 2]],
  ['Path.Combine', [2, Number.MAX_SAFE_INTEGER]],
  ['Path.GetFileName', [1, 1]],
  ['Path.GetDirectoryName', [1, 1]]
]);

/**
 * Per-method text shapes (`{x}` = binding, `{aN}` = exact arg source):
 *   - File.ReadAllText (bound, 1 arg)      → `{x} = contents of {a0}`
 *   - File.WriteAllText (2 args)           → `{a0} ← {a1}`
 *   - File.Copy (2–3 args)                 → `{a0} → {a1}` + `, overwrite` /
 *                                            `, no overwrite` for the literal
 *                                            `true`/`false` third arg
 *                                            (matchFileOp guarantees a third
 *                                            arg is a boolean literal)
 *   - Directory.GetFiles (bound, 1 arg)    → `{x} = files in {a0}`
 *   - Path.Combine (bound, ≥2 args)        → `{x} = {a0} + {a1} + …`
 *   - everything else / shape fallback     → `{x} = {call}` when bound,
 *                                            else the exact `{call}` source
 */
function fileOpText(
  key: string,
  binding: string | null,
  args: Node[],
  argSrc: string[],
  call: string
): string {
  switch (key) {
    case 'File.ReadAllText':
      if (binding !== null && argSrc.length === 1) {
        return `${binding} = contents of ${argSrc[0]}`;
      }
      break;
    case 'File.WriteAllText':
      if (argSrc.length === 2) return `${argSrc[0]} ← ${argSrc[1]}`;
      break;
    case 'File.Copy':
      if (argSrc.length === 2 || argSrc.length === 3) {
        // Both literal flag values render explicitly so the third arg is
        // never dropped from the card (non-literal flags never match).
        const flag =
          argSrc.length === 3
            ? args[2].text === 'true'
              ? ', overwrite'
              : ', no overwrite'
            : '';
        return `${argSrc[0]} → ${argSrc[1]}${flag}`;
      }
      break;
    case 'Directory.GetFiles':
      if (binding !== null && argSrc.length === 1) {
        return `${binding} = files in ${argSrc[0]}`;
      }
      break;
    case 'Path.Combine':
      if (binding !== null && argSrc.length >= 2) {
        return `${binding} = ${argSrc.join(' + ')}`;
      }
      break;
    default:
      break;
  }
  return binding !== null ? `${binding} = ${call}` : call;
}

function matchFileOp(
  stmt: Node,
  source: string
): { captures: Record<string, string> } | null {
  let binding: string | null = null;
  let value: Node;
  const bound = boundValueOf(stmt);
  if (bound !== null) {
    if (bound.op !== '=') return null;
    binding = bound.binding;
    value = bound.value;
  } else if (stmt.type === 'expression_statement') {
    const inner = firstNonComment(stmt);
    if (inner === null || inner.type === 'assignment_expression') return null;
    value = inner;
  } else {
    return null;
  }
  if (value.type !== 'invocation_expression') return null;
  const fn = value.childForFieldName('function');
  if (fn === null || fn.type !== 'member_access_expression') return null;
  const recv = fn.childForFieldName('expression');
  const name = fn.childForFieldName('name');
  if (recv === null || recv.type !== 'identifier') return null;
  if (name === null || name.type !== 'identifier') return null;
  const key = `${recv.text}.${name.text}`;
  const title = FILE_OP_TITLES.get(key);
  if (title === undefined) return null;
  const args = argumentValues(value.childForFieldName('arguments'));
  if (args === null || !args.every(isLiteralOrIdentifier)) return null;
  const arity = FILE_OP_ARITIES.get(key);
  if (arity === undefined) return null; // defensive: titled ⇒ arity row exists
  if (args.length < arity[0] || args.length > arity[1]) return null;
  // File.Copy's third arg is the overwrite FLAG: only a literal `true`/`false`
  // renders honestly (`, overwrite` / `, no overwrite`); any other flag
  // expression would have to be dropped from the card, so it stays tier-3.
  if (key === 'File.Copy' && args.length === 3 && args[2].type !== 'boolean_literal') {
    return null;
  }
  const argSrc = args.map((n) => sliceOf(n, source));
  return {
    captures: {
      title,
      text: fileOpText(key, binding, args, argSrc, sliceOf(value, source))
    }
  };
}

const FILE_OP: Tier2Rule = {
  id: 'file-op',
  family: 'file',
  m0Rank: 102,
  doc:
    'Static file-system API as a bare statement or bound value: a fixed ' +
    'File./Directory./Path. method whitelist (see FILE_OP_TITLES) with every ' +
    'arg a literal or identifier AND an allowed arity (see FILE_OP_ARITIES — ' +
    'wrong arities stay tier-3). File.Copy with 3 args needs a literal ' +
    'true/false overwrite flag, rendered ", overwrite" / ", no overwrite"; a ' +
    'non-literal flag stays tier-3. Text shapes per method are documented on ' +
    'fileOpText. Instance stream I/O (new StreamReader, fin.Read(buffer, ...)) ' +
    'stays tier-3.',
  match: matchFileOp,
  titleTemplate: '{title}',
  textTemplate: '{text}'
};

// ---------------------------------------------------------------------------
// Rule: datetime-arith (datetime, m0Rank 103 — pure floor)
// ---------------------------------------------------------------------------

/** `DateTime.<prop>` reads that are decidable without type inference. */
const NOW_WORDS: ReadonlyMap<string, string> = new Map([
  ['Now', 'now'],
  ['Today', 'today'],
  ['UtcNow', 'now (UTC)']
]);

/** `Add*` method → singular unit word. */
const ADD_UNITS: ReadonlyMap<string, string> = new Map([
  ['AddDays', 'day'],
  ['AddMonths', 'month'],
  ['AddYears', 'year'],
  ['AddHours', 'hour'],
  ['AddMinutes', 'minute']
]);

/** `DateTime.{Now,Today,UtcNow}` member access → its now-word, else null. */
function nowWordOf(node: Node): string | null {
  if (node.type !== 'member_access_expression') return null;
  const expr = node.childForFieldName('expression');
  const name = node.childForFieldName('name');
  if (expr === null || expr.type !== 'identifier' || expr.text !== 'DateTime') {
    return null;
  }
  if (name === null || name.type !== 'identifier') return null;
  return NOW_WORDS.get(name.text) ?? null;
}

function matchDatetimeArith(
  stmt: Node,
  _source: string
): { captures: Record<string, string> } | null {
  const bound = boundValueOf(stmt);
  if (bound === null || bound.op !== '=') return null;
  const value = bound.value;

  // Bare clock read: `var t = DateTime.Now;` → `Read clock | t = now`.
  const bareWord = nowWordOf(value);
  if (bareWord !== null) {
    return {
      captures: { title: 'Read clock', x: bound.binding, value: bareWord }
    };
  }

  // One Add* call on the clock: `DateTime.Today.AddDays(30)`.
  if (value.type !== 'invocation_expression') return null;
  const fn = value.childForFieldName('function');
  if (fn === null || fn.type !== 'member_access_expression') return null;
  const recv = fn.childForFieldName('expression');
  const name = fn.childForFieldName('name');
  if (recv === null || name === null || name.type !== 'identifier') return null;
  const unit = ADD_UNITS.get(name.text);
  const nowWord = nowWordOf(recv);
  if (unit === undefined || nowWord === null) return null;
  const args = argumentValues(value.childForFieldName('arguments'));
  if (args === null || args.length !== 1) return null;
  const arg = args[0];

  // Amount: integer literal, unary-minus integer literal, or identifier.
  let sign = '+';
  let amount: string;
  let singular = false;
  if (arg.type === 'integer_literal') {
    amount = arg.text;
    singular = Number(arg.text.replace(/[_lLuU]/g, '')) === 1;
  } else if (arg.type === 'prefix_unary_expression') {
    const op = arg.child(0);
    const inner = arg.namedChildren.find((c) => c.type === 'integer_literal');
    if (op === null || op.type !== '-' || inner === undefined) return null;
    sign = '−'; // U+2212, rendered with the absolute value
    amount = inner.text;
    singular = Number(inner.text.replace(/[_lLuU]/g, '')) === 1;
  } else if (arg.type === 'identifier') {
    amount = arg.text; // identifiers always render plural
  } else {
    return null;
  }

  return {
    captures: {
      title: 'Calculate date',
      x: bound.binding,
      value: `${nowWord} ${sign} ${amount} ${unit}${singular ? '' : 's'}`
    }
  };
}

const DATETIME_ARITH: Tier2Rule = {
  id: 'datetime-arith',
  family: 'datetime',
  m0Rank: 103,
  doc:
    'Clock reads and clock arithmetic bound to a variable: ' +
    '`DateTime.{Now,Today,UtcNow}` bare reads (`Read clock | t = now`) and a ' +
    'single `Add{Days,Months,Years,Hours,Minutes}(n)` call on such a read ' +
    'with n an integer literal, unary-minus literal, or identifier ' +
    '(`Calculate date | dueDate = today + 30 days`; negative literals render ' +
    'as U+2212 with the absolute value; the unit is singular only for ' +
    'literal ±1). DateTimeOffset/TimeSpan property reads and general +/− ' +
    'date arithmetic need type inference and stay tier-3.',
  match: matchDatetimeArith,
  titleTemplate: '{title}',
  textTemplate: '{x} = {value}'
};

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
> = [matchStringOp, matchLinqSingleChain, matchFileOp, matchDatetimeArith];

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

// ---------------------------------------------------------------------------
// Rule: string-op (string, M0 rank 19)
// ---------------------------------------------------------------------------

/** Literal node types accepted as "simple" arguments/operands. */
const LITERAL_TYPES: ReadonlySet<string> = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'character_literal',
  'integer_literal',
  'real_literal',
  'boolean_literal',
  'null_literal'
]);

/** Literal types that force STRING semantics on a `+` chain. */
const STRINGISH_TYPES: ReadonlySet<string> = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'interpolated_string_expression'
]);

function isLiteralOrIdentifier(node: Node): boolean {
  return LITERAL_TYPES.has(node.type) || node.type === 'identifier';
}

/** Value expression of one `argument` node (named args excluded), or null. */
function argumentValue(arg: Node): Node | null {
  const name = arg.childForFieldName('name');
  if (name !== null) return null; // named arguments stay tier-3
  const values = arg.namedChildren.filter((c) => c.type !== 'comment');
  return values.length === 1 ? values[0] : null;
}

/** All argument value expressions of an argument_list, or null when odd. */
function argumentValues(argList: Node | null): Node[] | null {
  if (argList === null) return null;
  const out: Node[] = [];
  for (const arg of argList.namedChildren) {
    if (arg.type === 'comment') continue;
    if (arg.type !== 'argument') return null;
    const value = argumentValue(arg);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/** Single-method whitelist with title per method (see manifest row 2). */
const STRING_METHOD_TITLES: ReadonlyMap<string, string> = new Map([
  ['Trim', 'Trim text'],
  ['TrimStart', 'Trim text'],
  ['TrimEnd', 'Trim text'],
  ['ToUpper', 'Upper-case text'],
  ['ToLower', 'Lower-case text'],
  ['Replace', 'Replace in text'],
  ['Substring', 'Take substring'],
  ['Split', 'Split text'],
  ['IndexOf', 'Find in text'],
  ['ToString', 'To text'],
  ['Append', 'Append text'],
  ['AppendLine', 'Append text']
]);

/**
 * Validate a `+` concat tree: every leaf literal/identifier/interpolated,
 * and (honesty shrink — see manifest) at least one leaf string-ish, which
 * forces string semantics without type inference.  Returns whether the tree
 * is a valid concat shape and whether a string-ish leaf was seen.
 */
function concatLeavesValid(node: Node): { valid: boolean; stringish: boolean } {
  if (node.type === 'binary_expression') {
    const op = node.childForFieldName('operator');
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (op === null || op.text !== '+' || left === null || right === null) {
      return { valid: false, stringish: false };
    }
    const l = concatLeavesValid(left);
    const r = concatLeavesValid(right);
    return { valid: l.valid && r.valid, stringish: l.stringish || r.stringish };
  }
  if (STRINGISH_TYPES.has(node.type)) return { valid: true, stringish: true };
  if (isLiteralOrIdentifier(node)) return { valid: true, stringish: false };
  return { valid: false, stringish: false };
}

function matchStringOp(
  stmt: Node,
  source: string
): { captures: Record<string, string> } | null {
  const bound = boundValueOf(stmt);
  if (bound === null) return null;
  const value = bound.value;
  // Escape hatches ANYWHERE in the RHS — including inside `$"{...}"`
  // interpolation holes and concat operands — keep the statement tier-3
  // (same fence as assign-from-call: await/lambda/query is hidden work).
  if (containsType(value, ESCAPE_HATCH_TYPES)) return null;
  const captures = (title: string): { captures: Record<string, string> } => ({
    captures: {
      title,
      x: bound.binding,
      op: bound.op,
      rhs: sliceOf(value, source)
    }
  });

  // (a) one whitelisted string method on an identifier receiver, all args
  // literal/identifier:  `var clean = rawName.Trim();`
  if (value.type === 'invocation_expression') {
    const fn = value.childForFieldName('function');
    if (fn === null || fn.type !== 'member_access_expression') return null;
    const recv = fn.childForFieldName('expression');
    const name = fn.childForFieldName('name');
    if (recv === null || recv.type !== 'identifier') return null;
    if (name === null || name.type !== 'identifier') return null;
    const title = STRING_METHOD_TITLES.get(name.text);
    if (title === undefined) return null;
    const args = argumentValues(value.childForFieldName('arguments'));
    if (args === null || !args.every(isLiteralOrIdentifier)) return null;
    return captures(title);
  }

  // (c) interpolation initializer:  `var s = $"...";`  (declarations only)
  if (value.type === 'interpolated_string_expression') {
    if (bound.context === 'declaration') return captures('Compose text');
    // `x += $"..."` is an append — shape (b) below; plain `x = $"..."`
    // reassignment stays tier-3 (manifest: interpolation INITIALIZERS).
    if (bound.op === '+=') return captures('Build text');
    return null;
  }

  // (b) concat builds:  `x = a + " " + b;` — at least one string-ish leaf
  // (honesty shrink: identifier-only `+` could be numeric).  `x += <expr>`
  // matches only with a string-ish RHS for the same reason.
  if (value.type === 'binary_expression') {
    const concat = concatLeavesValid(value);
    if (!concat.valid || !concat.stringish) return null;
    return captures('Build text');
  }
  if (bound.op === '+=' && STRINGISH_TYPES.has(value.type)) {
    return captures('Build text');
  }
  return null;
}

const STRING_OP: Tier2Rule = {
  id: 'string-op',
  family: 'string',
  m0Rank: 19,
  doc:
    'Single string operation bound to a variable: (a) one whitelisted method ' +
    '(Trim/TrimStart/TrimEnd/ToUpper/ToLower/Replace/Substring/Split/IndexOf/' +
    'ToString/Append/AppendLine) on an identifier receiver with ' +
    'literal/identifier args, as decl init, `=` or `+=` assign; (b) `+` concat ' +
    'whose leaves are literal/identifier/interpolated with at least one ' +
    'string-ish leaf, and `+= <string-ish>` appends; (c) `$"..."` declaration ' +
    'initializers. Any await/lambda/query anywhere in the RHS — interpolation ' +
    'holes included — stays tier-3, as do fluent chains of >=2 ops and nested ' +
    'format calls.',
  match: matchStringOp,
  titleTemplate: '{title}',
  textTemplate: '{x} {op} {rhs}'
};

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
export const TIER2_RULES: readonly Tier2Rule[] = [
  ASSIGN_FROM_CALL,
  STRING_OP,
  LINQ_SINGLE_CHAIN,
  FILE_OP,
  DATETIME_ARITH
];

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
