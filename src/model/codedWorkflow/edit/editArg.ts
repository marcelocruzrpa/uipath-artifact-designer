// PURITY: imports only model types + sibling pure modules — never the parser.
import type { CodedWorkflowModel, CwActivityCard, OffsetSpan } from '../cwTypes';
import type { EditArgIntent, EditResult } from './editTypes';
import { findNodeById } from './findNode';

/** Narrow a found node to an activity card that carries argument spans. */
function activityWithArgs(
  model: CodedWorkflowModel,
  id: string
): CwActivityCard | { error: string } {
  const node = findNodeById(model, id);
  if (node === null) return { error: `node not found: ${id}` };
  if (node.type !== 'activity') return { error: 'only activity cards have editable arguments' };
  if (node.argListSpan === undefined) return { error: 'this call has no editable argument list' };
  return node;
}

export function editArg(source: string, model: CodedWorkflowModel, intent: EditArgIntent): EditResult {
  const found = activityWithArgs(model, intent.id);
  if ('error' in found) return { ok: false, error: found.error };
  const card = found;

  switch (intent.op) {
    case 'change': {
      const arg = card.args[intent.argIndex ?? -1];
      if (arg === undefined || arg.argSpan === undefined) {
        return { ok: false, error: `arg ${intent.argIndex} is not replaceable` };
      }
      if (intent.newText === undefined) return { ok: false, error: 'change requires newText' };
      // argSpan covers the WHOLE `argument` node, which for a C# named argument
      // (`name: value`) includes the `name:` prefix. Replacing the whole span
      // would silently drop the name and re-bind by position. Reject it — value
      // edits route through editValue's valueSpan, so this op never legitimately
      // targets a named argument.
      if (isNamedArgument(source.slice(arg.argSpan.start, arg.argSpan.end))) {
        return { ok: false, error: 'cannot change a named argument by replacing its whole span (would drop the name)' };
      }
      return { ok: true, patches: [{ start: arg.argSpan.start, end: arg.argSpan.end, newText: intent.newText }] };
    }

    case 'add': {
      if (intent.newText === undefined) return { ok: false, error: 'add requires newText' };
      const interior = card.argListSpan!;
      const empty = interior.start === interior.end;
      if (empty) {
        // Splice the first argument at the empty interior.
        return { ok: true, patches: [{ start: interior.start, end: interior.start, newText: intent.newText }] };
      }
      // Append after the last existing argument: `, <newText>` at the interior end.
      return { ok: true, patches: [{ start: interior.end, end: interior.end, newText: `, ${intent.newText}` }] };
    }

    case 'remove': {
      const idx = intent.argIndex ?? -1;
      const arg = card.args[idx];
      if (arg === undefined || arg.argSpan === undefined) {
        return { ok: false, error: `arg ${idx} is not removable` };
      }
      const span = removalRange(source, card, idx, arg.argSpan);
      return { ok: true, patches: [{ start: span.start, end: span.end, newText: '' }] };
    }

    case 'method': {
      if (intent.newMethod === undefined) return { ok: false, error: 'method switch requires newMethod' };
      // The method name immediately precedes the argument list. Search the
      // statement's char range for `<method>(` and replace just the name.
      const stmtStart = offsetOfSpanStart(source, card);
      const needle = `${card.method}(`;
      const at = source.indexOf(needle, stmtStart);
      if (at < 0 || at >= card.argListSpan!.start) {
        return { ok: false, error: 'could not locate the method name to switch' };
      }
      return { ok: true, patches: [{ start: at, end: at + card.method.length, newText: intent.newMethod }] };
    }

    default:
      return { ok: false, error: `unsupported editArg op: ${(intent as { op: string }).op}` };
  }
}

/**
 * Removal range for arg #idx: the argument plus exactly ONE adjacent separator
 * so the list stays well-formed. Prefer eating the PRECEDING `,` (and the
 * whitespace after it) when the arg is not the first; otherwise eat the
 * FOLLOWING `,` and whitespace. Pure string scan over `source`.
 */
function removalRange(
  source: string,
  card: CwActivityCard,
  idx: number,
  argSpan: OffsetSpan
): OffsetSpan {
  const interior = card.argListSpan!;
  if (idx > 0) {
    // Walk left over whitespace then a single comma.
    let start = argSpan.start;
    let i = start - 1;
    while (i > interior.start && /\s/.test(source[i])) i -= 1;
    if (source[i] === ',') start = i;
    return { start, end: argSpan.end };
  }
  // First arg: walk right over a single comma then whitespace.
  let end = argSpan.end;
  let i = end;
  while (i < interior.end && /\s/.test(source[i])) i += 1;
  if (source[i] === ',') {
    i += 1;
    while (i < interior.end && /\s/.test(source[i])) i += 1;
    end = i;
  }
  return { start: argSpan.start, end };
}

/**
 * True when an `argument` slice is a C# NAMED argument (`name: value`). The
 * slice is exactly one `argument` node, so a named arg always opens with a bare
 * identifier followed by a single `:` (not `::`, the namespace separator). A
 * positional arg opens with an expression — a string/number/`(`/member access —
 * never a bare-identifier-then-colon, and a ternary's `:` is mid-expression
 * (preceded by `?`), so this prefix-only test cannot misfire on positional args.
 */
function isNamedArgument(slice: string): boolean {
  const m = /^\s*[A-Za-z_]\w*\s*:/.exec(slice);
  if (m === null) return false;
  // Reject the namespace separator `::` (e.g. `global::Foo`): the char after the
  // matched colon must not be another colon.
  return slice.charAt(m[0].length) !== ':';
}

/** Char offset of the card's statement start, from its line/col SourceSpan. */
function offsetOfSpanStart(source: string, card: CwActivityCard): number {
  // Convert {startLine,startCol} to a char offset by counting newlines.
  let line = 0;
  let i = 0;
  for (; i < source.length && line < card.span.startLine; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return i + card.span.startCol;
}
