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
 *     object creations render the first string literal found inside; both
 *     kind 'target'.  Other shapes fall back to the shared rendering.
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

/** How many args the generic (uncataloged) extractor surfaces. */
const GENERIC_ARG_COUNT = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract card arg summaries from a tier-1 matched invocation.
 * With a catalog entry, rows follow the entry's `args` specs; without one,
 * the generic extractor surfaces the first two args as `arg1`/`arg2`.
 */
export function extractArgs(
  invocation: Node | undefined,
  entry: CatalogEntry | undefined,
  source: string
): CwArgSummary[] {
  if (invocation === undefined) return [];
  const args = argumentNodes(invocation);
  if (entry !== undefined) {
    const out: CwArgSummary[] = [];
    for (const spec of entry.args) {
      const row = renderSpec(spec, args, source);
      if (row !== null) out.push(row);
    }
    return out;
  }
  return args.slice(0, GENERIC_ARG_COUNT).map((arg, i) => {
    const value = argValueNode(arg);
    const rendered: Rendered =
      value !== null
        ? renderValue(value, source, ARG_VALUE_MAX_LEN)
        : { value: '', kind: 'expression', editableKind: 'none' };
    return finalize(`arg${i + 1}`, rendered);
  });
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
  const arg = subscript.namedChildren.find((c) => c.type === 'argument');
  const value = arg !== undefined ? argValueNode(arg) : null;
  if (value === null) return [];
  return [finalize('Key', renderValue(value, source, ARG_VALUE_MAX_LEN))];
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

/** Resolve a spec to its argument node: Nth unnamed, or named by name. */
function findSpecArg(spec: CatalogArgSpec, args: Node[]): Node | null {
  if (typeof spec.arg === 'number') {
    const unnamed = args.filter((a) => a.childForFieldName('name') === null);
    return unnamed[spec.arg] ?? null;
  }
  return (
    args.find((a) => a.childForFieldName('name')?.text === spec.arg) ?? null
  );
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

/** Map a backing value node's syntactic type to its form-edit affordance. */
function editableKindOf(node: Node): CwArgSummary['editableKind'] {
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
      return 'string';
    case 'integer_literal':
    case 'real_literal':
      return 'number';
    case 'boolean_literal':
      return 'bool';
    case 'member_access_expression':
      return 'enum';
    case 'identifier':
      return 'identifier';
    case 'interpolated_string_expression':
      return 'raw';
    default:
      return 'raw';
  }
}

/** Build the final summary row from a label + rendered value/edit metadata. */
function finalize(label: string, rendered: Rendered): CwArgSummary {
  return {
    label,
    value: rendered.value,
    kind: rendered.kind,
    editableKind: rendered.editableKind,
    ...(rendered.node !== undefined
      ? { valueSpan: { start: rendered.node.startIndex, end: rendered.node.endIndex } }
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

/** 'target' rendering: dotted-chain tail or first string inside `new ...`. */
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
    const literal = findFirstStringLiteral(value);
    if (literal !== null) {
      // The surfaced string literal IS a faithful backing token (a `new`
      // resource name), editable as a string field.
      return { value: unquote(sliceOf(literal, source)), kind: 'target', editableKind: 'string', node: literal };
    }
  }
  return renderValue(value, source, maxLen);
}

/** Depth-first search for the first string literal descendant. */
function findFirstStringLiteral(node: Node): Node | null {
  if (node.type === 'string_literal' || node.type === 'verbatim_string_literal') {
    return node;
  }
  for (const child of node.namedChildren) {
    const found = findFirstStringLiteral(child);
    if (found !== null) return found;
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

/** Render one catalog arg spec to a summary row, or null when absent. */
function renderSpec(
  spec: CatalogArgSpec,
  args: Node[],
  source: string
): CwArgSummary | null {
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
  return finalize(spec.label, rendered);
}
