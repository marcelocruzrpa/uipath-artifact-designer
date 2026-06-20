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
      // targets a named argument. `isNamed` is parser-derived, so it also catches
      // `@`-verbatim / unicode names a text regex would miss.
      if (arg.isNamed) {
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
      // C# forbids a POSITIONAL argument after a NAMED one (CS1738). Appending
      // `, <newText>` trailing a named arg compiles-invalid yet parses clean, so
      // the syntax gate misses it. `hasNamedArg` is computed over ALL call args
      // (not just surfaced rows), so a named arg hidden in the overflow is caught.
      if (card.hasNamedArg) {
        return { ok: false, error: 'cannot append a positional argument after a named argument' };
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
      // A comment between the arg and its separating comma (`Foo(a /*c*/, b)`)
      // would either be partly eaten or left dangling by the whitespace-only
      // comma scan below. Reject when a comment sits adjacent to the comma we
      // would consume rather than risk a malformed list.
      if (commentAdjacentToSeparator(source, card, idx, arg.argSpan)) {
        return { ok: false, error: 'cannot remove an argument with an adjacent comment' };
      }
      const span = removalRange(source, card, idx, arg.argSpan);
      return { ok: true, patches: [{ start: span.start, end: span.end, newText: '' }] };
    }

    case 'method': {
      if (intent.newMethod === undefined) return { ok: false, error: 'method switch requires newMethod' };
      // Patch the EXACT method-name token captured from the parse tree. Scanning
      // source for `<method>(` would patch an earlier same-named call in a chain
      // (`a.GetAsset().GetAsset(1)`); the stored span cannot. Refuse when absent.
      if (card.methodNameSpan === undefined) {
        return { ok: false, error: 'could not locate the method name to switch' };
      }
      return {
        ok: true,
        patches: [{ start: card.methodNameSpan.start, end: card.methodNameSpan.end, newText: intent.newMethod }]
      };
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
 * True when a comment sits between arg #idx and the comma `removalRange` would
 * consume — mirrors that function's direction choice (eat the PRECEDING comma
 * for a non-first arg, else the FOLLOWING one). We walk the same whitespace gap
 * and flag a `/` (the start of `//` or a `/* … *​/`), since the plain `\s` scan
 * in `removalRange` would stop at it and miscompute the comma boundary.
 */
function commentAdjacentToSeparator(
  source: string,
  card: CwActivityCard,
  idx: number,
  argSpan: OffsetSpan
): boolean {
  const interior = card.argListSpan!;
  if (idx > 0) {
    // Walk left over whitespace toward the preceding comma; a `/` en route is a
    // comment's close (`*/`) or, less commonly, a `//` line on the wrapped line.
    let i = argSpan.start - 1;
    while (i > interior.start && /\s/.test(source[i])) i -= 1;
    return source[i] === '/';
  }
  // First arg: walk right over whitespace toward the following comma.
  let i = argSpan.end;
  while (i < interior.end && /\s/.test(source[i])) i += 1;
  return source[i] === '/';
}

