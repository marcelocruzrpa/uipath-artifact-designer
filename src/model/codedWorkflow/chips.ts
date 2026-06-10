/**
 * Per-slot raw-chip post-pass: adjacent `CwRawChip` children merge into one
 * chip whose `code` is RE-SLICED from source between the first chip's start
 * and the last chip's end — interleaved comments and blank lines are kept
 * verbatim.  Cards and containers between chips break the run.
 *
 * Merged chips sum `statementCount`; `lineCount` is span-derived.  EVERY chip
 * leaving this pass (merged or single) is subject to the
 * `CHIP_CODE_MAX_LINES` cap: `code` keeps the first 40 lines,
 * `codeTruncated` flips true, and `lineCount` keeps the full span height —
 * so accounting never loses statements, only display text.
 *
 * Non-truncated chips keep the invariant `code === exact source slice of
 * span`.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { CwRawChip, CwStatement, SourceSpan } from './cwTypes';
import { CHIP_CODE_MAX_LINES } from './limits';

/**
 * Merge adjacent raw chips in one slot's children.  Returns a new array;
 * non-chip children are passed through untouched.
 */
export function mergeAdjacentChips(children: CwStatement[], source: string): CwStatement[] {
  const out: CwStatement[] = [];
  let run: CwRawChip[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    out.push(run.length === 1 ? capChip(run[0]) : mergeRun(run, source));
    run = [];
  };

  for (const child of children) {
    if (child.type === 'raw') {
      run.push(child);
    } else {
      flush();
      out.push(child);
    }
  }
  flush();
  return out;
}

/** Merge a run of >=2 chips into one re-sliced chip. */
function mergeRun(run: CwRawChip[], source: string): CwRawChip {
  const first = run[0];
  const last = run[run.length - 1];
  const span: SourceSpan = {
    startLine: first.span.startLine,
    startCol: first.span.startCol,
    endLine: last.span.endLine,
    endCol: last.span.endCol
  };
  return capChip({
    id: '',
    span,
    type: 'raw',
    tier: 3,
    code: sliceSpan(source, span),
    lineCount: span.endLine - span.startLine + 1,
    statementCount: run.reduce((sum, chip) => sum + chip.statementCount, 0),
    codeTruncated: false
  });
}

/** Apply the CHIP_CODE_MAX_LINES cap to one chip (idempotent). */
function capChip(chip: CwRawChip): CwRawChip {
  if (chip.codeTruncated) return chip;
  const lines = chip.code.split('\n');
  if (lines.length <= CHIP_CODE_MAX_LINES) return chip;
  return {
    ...chip,
    code: lines.slice(0, CHIP_CODE_MAX_LINES).join('\n'),
    codeTruncated: true
  };
}

/** Exact source slice of a 0-based line/col span. */
function sliceSpan(source: string, span: SourceSpan): string {
  const lines = source.split('\n');
  if (span.startLine === span.endLine) {
    return lines[span.startLine]?.slice(span.startCol, span.endCol) ?? '';
  }
  const parts: string[] = [lines[span.startLine]?.slice(span.startCol) ?? ''];
  for (let i = span.startLine + 1; i < span.endLine; i += 1) {
    parts.push(lines[i] ?? '');
  }
  parts.push(lines[span.endLine]?.slice(0, span.endCol) ?? '');
  return parts.join('\n');
}
