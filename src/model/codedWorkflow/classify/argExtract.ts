/**
 * Card argument extraction: turns an invocation's `argument_list` into
 * `CwArgSummary[]` rows, either per the matched `CatalogEntry`'s arg specs or
 * via the generic first-two-args fallback for uncataloged members.
 *
 * VALUE RENDERING (shared by all specs)
 *   - string / verbatim / raw / char literals → content without delimiters
 *     (no unescaping), kind 'literal'.  Numeric / bool / null literals →
 *     verbatim text, kind 'literal'.
 *   - interpolated strings → content without `$"`/`"` delimiters, `{expr}`
 *     holes kept verbatim, kind 'interpolated'.
 *   - identifiers → the name, kind 'identifier'.
 *   - anything else → whitespace-collapsed source slice truncated to
 *     `maxLen` (default 48) + '…', kind 'expression'.
 *   Values are unwrapped through await/parens/casts/`as` first.
 *
 * SPEC-SPECIFIC RENDERING
 *   - 'text' / 'path' / 'enum' → the shared value rendering above.
 *   - 'target' → member-access chains render their LAST TWO dotted segments;
 *     object creations render the string literal of a RECOGNIZED selector
 *     property (`Selector`/`FullSelector`/`FuzzySelector`/`Target`) — never a
 *     guessed first-string-anywhere — both kind 'target'.  With no recognized
 *     selector, the whole `new …` falls back to read-only shared rendering.
 *   - 'objectProps' → `Prop: value` pairs (shared rendering per value) for
 *     the spec'd property names found in the object initializer, joined by
 *     ', ', kind 'expression'.  No matching props → no row.
 *
 * ARG LOOKUP: a numeric spec selects the Nth UNNAMED argument; a string spec
 * selects the named argument with that name.  Missing args produce no row.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import type { CwArgSummary } from '../cwTypes';
import type { CatalogArgSpec, CatalogEntry } from './tier1Catalog';
import { unwrapExpression } from './tier1Match';

/** Default cap for 'expression'-kind rendered values. */
export const ARG_VALUE_MAX_LEN = 48;

/**
 * Cap for the per-argument values surfaced in the `+N more` overflow detail
 * (shown in the properties panel, which wraps): more generous than the compact
 * card cap so a folded argument's value stays legible.
 */
export const OVERFLOW_ARG_MAX_LEN = 200;

/** How many args the generic (uncataloged) extractor surfaces. */
const GENERIC_ARG_COUNT = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract card arg summaries from a tier-1 matched invocation.
 * With a catalog entry, rows follow the entry's `args` specs; without one,
 * the generic extractor surfaces the first two args as `arg1`/`arg2`.
 *
 * HONESTY: a card must never present a strict prefix of the call's arguments
 * as the whole call.  Any `argument` node not faithfully rendered by a row is
 * folded into ONE read-only overflow row (`+N more`) carrying the remaining
 * args' verbatim source — never editable, never dropped.
 */
export function extractArgs(
  invocation: Node | undefined,
  entry: CatalogEntry | undefined,
  source: string
): CwArgSummary[] {
  if (invocation === undefined) return [];
  const args = argumentNodes(invocation);
  const out: CwArgSummary[] = [];
  /** `argument` nodes faithfully rendered by a row — by node id. */
  const covered = new Set<number>();

  if (entry !== undefined) {
    for (const spec of entry.args) {
      const resolved = renderSpec(spec, args, source);
      if (resolved === null) continue;
      out.push(resolved.row);
      if (resolved.argNode !== null) covered.add(resolved.argNode.id);
    }
  } else {
    for (const arg of args.slice(0, GENERIC_ARG_COUNT)) {
      const value = argValueNode(arg);
      const rendered: Rendered =
        value !== null
          ? renderValue(value, source, ARG_VALUE_MAX_LEN)
          : { value: '', kind: 'expression', editableKind: 'none' };
      out.push(finalize(`arg${out.length + 1}`, rendered, source, arg));
      covered.add(arg.id);
    }
  }

  const overflow = overflowRow(args, covered, source);
  if (overflow !== null) out.push(overflow);
  return out;
}

/**
 * Fold every `argument` not in `covered` into one read-only `+N more` row whose
 * value is the clipped verbatim source of those args, joined in source order.
 * Carries NO valueSpan/argSpan so the edit engine never treats it as editable.
 * Returns null when every argument is already covered.
 */
function overflowRow(
  args: Node[],
  covered: ReadonlySet<number>,
  source: string
): CwArgSummary | null {
  const remaining = args.filter((a) => !covered.has(a.id));
  if (remaining.length === 0) return null;
  const joined = remaining.map((a) => sliceOf(a, source)).join(', ');
  // Structured, read-only detail for the properties panel: one row per folded
  // argument so a many-arg call reveals every argument (the CARD still shows
  // only the compact `+N more` summary below).
  const overflowArgs: CwArgSummary[] = remaining.map((arg) => {
    const name = argName(arg);
    const valueNode = argValueNode(arg);
    const label = name ?? `arg${args.indexOf(arg) + 1}`;
    return {
      label,
      value: valueNode !== null ? clip(sliceOf(valueNode, source), OVERFLOW_ARG_MAX_LEN) : '',
      kind: 'expression',
      editableKind: 'none'
    };
  });
  return {
    label: `+${remaining.length} more`,
    value: clip(joined, ARG_VALUE_MAX_LEN),
    kind: 'expression',
    editableKind: 'none',
    overflowArgs
  };
}

/**
 * Arg summary for an `[indexer]` match (M0 lever L2): one `Key` row rendered
 * from the first argument of the bracketed subscript.
 */
export function extractIndexerKey(
  subscript: Node | undefined,
  source: string
): CwArgSummary[] {
  if (subscript === undefined) return [];
  const args = subscript.namedChildren.filter((c) => c.type === 'argument');
  if (args.length === 0) return [];
  // Render EVERY subscript key so a multi-key indexer (`matrix[row, col]`) is
  // not silently reduced to its first key.  A single key keeps the bare `Key`
  // label; multiple keys are `Key1`, `Key2`, … in source order.
  const out: CwArgSummary[] = [];
  args.forEach((arg, i) => {
    const value = argValueNode(arg);
    if (value === null) return;
    const label = args.length === 1 ? 'Key' : `Key${i + 1}`;
    // No argSpan for indexer keys (parity with the single-key form): a
    // subscript key has no `argument`-node delete/replace contract.
    out.push(finalize(label, renderValue(value, source, ARG_VALUE_MAX_LEN), source));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Argument lookup
// ---------------------------------------------------------------------------

/** `argument` nodes of the invocation's argument_list, in source order. */
function argumentNodes(invocation: Node): Node[] {
  const argList = invocation.childForFieldName('arguments');
  if (argList === null) return [];
  return argList.namedChildren.filter((c) => c.type === 'argument');
}

/** The value expression of one `argument` node (name field excluded). */
function argValueNode(arg: Node): Node | null {
  const nameField = arg.childForFieldName('name');
  const values = arg.namedChildren.filter(
    (c) => (nameField === null || c.id !== nameField.id) && c.type !== 'comment'
  );
  return values.length > 0 ? values[values.length - 1] : null;
}

/** The `name:` of an `argument` node, or null when it is positional. */
function argName(arg: Node): string | null {
  return arg.childForFieldName('name')?.text ?? null;
}

/**
 * Resolve a spec to its argument node.  For a numeric spec: if any argument is
 * passed BY NAME matching the spec's known C# parameter name
 * (`GetAsset(name: "x")`), that explicit binding wins; otherwise the Nth
 * UNNAMED argument is selected positionally.  A string spec selects the named
 * argument with that name.  Resolving named positionals keeps an explicitly
 * named arg from being dropped (and then surfaced as raw overflow).
 */
function findSpecArg(spec: CatalogArgSpec, args: Node[]): Node | null {
  if (typeof spec.arg === 'number') {
    if (spec.paramName !== undefined) {
      const named = args.find((a) => argName(a) === spec.paramName);
      if (named !== undefined) return named;
    }
    const unnamed = args.filter((a) => argName(a) === null);
    return unnamed[spec.arg] ?? null;
  }
  return args.find((a) => argName(a) === spec.arg) ?? null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * One rendered value plus its edit metadata.  `node` is the EXACT backing
 * source token whose range becomes the row's `valueSpan` — set only when the
 * rendered value faithfully stands for that whole token (so the invariant
 * `source.slice(valueSpan) === source of node` holds).  Synthesized/derived
 * renderings (object-prop summaries, truncated member-access tails) carry no
 * `node` and report `editableKind: 'none'`.
 */
interface Rendered {
  value: string;
  kind: CwArgSummary['kind'];
  editableKind: CwArgSummary['editableKind'];
  /** Backing value token; its [startIndex, endIndex) becomes `valueSpan`. */
  node?: Node;
}

/**
 * A member access that plausibly names an enum CONSTANT: `Type.Member` where
 * the receiver is a bare PascalCase identifier (a type name, not `this` or a
 * lowercase variable) and the member is PascalCase.  This excludes ordinary
 * property reads (`obj.Length`, `this.Foo`, `config.timeout`), which are NOT
 * enum constants and must not be offered as an enum dropdown.
 */
function isPlausibleEnumRef(node: Node): boolean {
  if (node.type !== 'member_access_expression') return false;
  const expr = node.childForFieldName('expression');
  const name = node.childForFieldName('name');
  if (expr === null || name === null) return false;
  if (expr.type !== 'identifier' || name.type !== 'identifier') return false;
  return /^[A-Z]/.test(expr.text) && /^[A-Z]/.test(name.text);
}

/** Map a backing value node's syntactic type to its form-edit affordance. */
function editableKindOf(node: Node): CwArgSummary['editableKind'] {
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
      return 'string';
    case 'raw_string_literal':
      // Raw strings round-trip the whole `"""…"""` token verbatim through the
      // edit engine, so they are edited as raw text, not a plain string field.
      return 'raw';
    case 'integer_literal':
    case 'real_literal':
      return 'number';
    case 'boolean_literal':
      return 'bool';
    case 'member_access_expression':
      // Only a plausible enum constant (`Type.Member`) gets the enum
      // affordance; a property read (`obj.Length`) is raw, not an enum.
      return isPlausibleEnumRef(node) ? 'enum' : 'raw';
    case 'identifier':
      return 'identifier';
    case 'interpolated_string_expression':
      return 'raw';
    default:
      return 'raw';
  }
}

/**
 * Build the final summary row from a label + rendered value/edit metadata.
 * When a backing `node` is present, both `valueSpan` and its exact source slice
 * `valueRaw` are emitted from it, so the invariant
 * `valueRaw === source.slice(valueSpan.start, valueSpan.end)` always holds.
 * The owning `argNode` (the whole `argument`, name + value) records `argSpan`
 * for structural edits; it is omitted for synthesized rows (indexer keys).
 */
function finalize(
  label: string,
  rendered: Rendered,
  source: string,
  argNode?: Node
): CwArgSummary {
  return {
    label,
    value: rendered.value,
    kind: rendered.kind,
    editableKind: rendered.editableKind,
    ...(argNode !== undefined && argName(argNode) !== null ? { isNamed: true } : {}),
    ...(argNode !== undefined ? { argSpan: { start: argNode.startIndex, end: argNode.endIndex } } : {}),
    ...(rendered.node !== undefined
      ? {
          valueSpan: { start: rendered.node.startIndex, end: rendered.node.endIndex },
          valueRaw: source.slice(rendered.node.startIndex, rendered.node.endIndex)
        }
      : {})
  };
}

function sliceOf(node: Node, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

/** Strip string delimiters: `"x"`, `@"x"`, `$"x"`, `$@"x"`, `"""x"""`. */
function unquote(text: string): string {
  const match = /^[@$]{0,2}"{1,3}([\s\S]*?)"{1,3}$/.exec(text);
  return match !== null ? match[1] : text;
}

/** Collapse whitespace runs and truncate to `maxLen` + '…'. */
function clip(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed;
}

/** Shared value rendering (see module header). */
function renderValue(node: Node, source: string, maxLen: number): Rendered {
  const value = unwrapExpression(node);
  const editableKind = editableKindOf(value);
  switch (value.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
    case 'character_literal':
      return { value: unquote(sliceOf(value, source)), kind: 'literal', editableKind, node: value };
    case 'integer_literal':
    case 'real_literal':
    case 'boolean_literal':
    case 'null_literal':
      return { value: sliceOf(value, source), kind: 'literal', editableKind, node: value };
    case 'interpolated_string_expression':
      return {
        value: unquote(sliceOf(value, source)),
        kind: 'interpolated',
        editableKind,
        node: value
      };
    case 'identifier':
      return { value: sliceOf(value, source), kind: 'identifier', editableKind, node: value };
    default:
      return {
        value: clip(sliceOf(value, source), maxLen),
        kind: 'expression',
        editableKind,
        node: value
      };
  }
}

/**
 * Property names on a UiPath target object whose string value IS the selector
 * — the only initializer properties whose literal may be surfaced as the
 * automation target (and edited as a string).  Any other string anywhere in
 * the object (a timeout message, an activity name) is NOT the target.
 */
const SELECTOR_PROPS: readonly string[] = ['Selector', 'FullSelector', 'FuzzySelector', 'Target'];

/** 'target' rendering: dotted-chain tail or the recognized selector property. */
function renderTarget(node: Node, source: string, maxLen: number): Rendered {
  const value = unwrapExpression(node);
  if (
    value.type === 'member_access_expression' ||
    value.type === 'conditional_access_expression'
  ) {
    // Truncated to the last two dotted segments — the displayed value no
    // longer stands for the whole chain token, so it is not editable inline.
    const segments = sliceOf(value, source).split('.');
    return { value: segments.slice(-2).join('.'), kind: 'target', editableKind: 'none' };
  }
  if (
    value.type === 'object_creation_expression' ||
    value.type === 'implicit_object_creation_expression'
  ) {
    // Surface ONLY a recognized selector property's string literal — never a
    // guessed first-string-anywhere (which could be a message/name and would
    // be mislabeled the target AND wrongly marked editable).
    const selector = findSelectorLiteral(value);
    if (selector !== null) {
      return { value: unquote(sliceOf(selector, source)), kind: 'target', editableKind: 'string', node: selector };
    }
    // No recognized selector → fall back to read-only shared rendering rather
    // than guessing; the whole `new …` is shown as a non-editable expression.
  }
  return renderValue(value, source, maxLen);
}

/**
 * The string literal assigned to a recognized selector property in an object
 * initializer (`new TargetAnchorable { Selector = "<wnd .../>" }`), or null
 * when none is present.  Only direct `Prop = "literal"` assignments qualify.
 */
function findSelectorLiteral(creation: Node): Node | null {
  const initializer =
    creation.childForFieldName('initializer') ??
    creation.namedChildren.find((c) => c.type === 'initializer_expression') ??
    null;
  if (initializer === null) return null;
  for (const assignment of initializer.namedChildren) {
    if (assignment.type !== 'assignment_expression') continue;
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    if (left === null || right === null) continue;
    if (!SELECTOR_PROPS.includes(left.text)) continue;
    if (right.type === 'string_literal' || right.type === 'verbatim_string_literal') {
      return right;
    }
  }
  return null;
}

/** 'objectProps' rendering: `Prop: value` pairs from the initializer. */
function renderObjectProps(
  node: Node,
  props: readonly string[],
  source: string,
  maxLen: number
): Rendered | null {
  const value = unwrapExpression(node);
  const initializer =
    value.type === 'object_creation_expression' ||
    value.type === 'implicit_object_creation_expression'
      ? (value.childForFieldName('initializer') ??
        value.namedChildren.find((c) => c.type === 'initializer_expression') ??
        null)
      : null;
  if (initializer === null) return null;

  const pairs: string[] = [];
  for (const assignment of initializer.namedChildren) {
    if (assignment.type !== 'assignment_expression') continue;
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    if (left === null || right === null) continue;
    if (!props.includes(left.text)) continue;
    pairs.push(`${left.text}: ${renderValue(right, source, maxLen).value}`);
  }
  if (pairs.length === 0) return null;
  // A multi-property summary has no single backing token — read-only.
  return { value: pairs.join(', '), kind: 'expression', editableKind: 'none' };
}

/** A rendered catalog row plus the `argument` node it consumed (for overflow accounting). */
interface ResolvedSpec {
  row: CwArgSummary;
  /** The `argument` node this row faithfully renders, or null if synthesized. */
  argNode: Node | null;
}

/** Render one catalog arg spec to a summary row + its source arg, or null when absent. */
function renderSpec(
  spec: CatalogArgSpec,
  args: Node[],
  source: string
): ResolvedSpec | null {
  const arg = findSpecArg(spec, args);
  if (arg === null) return null;
  const value = argValueNode(arg);
  if (value === null) return null;
  const maxLen = spec.maxLen ?? ARG_VALUE_MAX_LEN;

  let rendered: Rendered | null;
  switch (spec.render) {
    case 'target':
      rendered = renderTarget(value, source, maxLen);
      break;
    case 'objectProps':
      rendered = renderObjectProps(value, spec.props ?? [], source, maxLen);
      break;
    default:
      // 'text' / 'path' / 'enum' share the value rendering.
      rendered = renderValue(value, source, maxLen);
      break;
  }
  if (rendered === null) return null;
  // The whole `argument` is consumed by this row even when the rendered value
  // is a synthesized summary (objectProps / truncated target) — so it must not
  // also appear in the `+N more` overflow.
  return { row: finalize(spec.label, rendered, source, arg), argNode: arg };
}
