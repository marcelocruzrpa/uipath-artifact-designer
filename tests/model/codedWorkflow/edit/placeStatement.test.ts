import { it, expect } from 'vitest';
import { insertionPatch, deletionPatch } from '../../../../src/model/codedWorkflow/edit/placeStatement';
import type { CwStatement } from '../../../../src/model/codedWorkflow/cwTypes';

const stmtAt = (start: number, end: number): CwStatement => ({
  id: 'x', type: 'raw', tier: 3, code: '', lineCount: 1, statementCount: 1, codeTruncated: false,
  span: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 }, offsets: { start, end }
});

it('appends after the last child on its own indented line', () => {
  const children = [stmtAt(10, 19)]; // a 9-char statement
  const patch = insertionPatch(
    { children, bodySpan: { start: 8, end: 22 }, indentText: '    ' },
    1,
    'Log("z");',
    '\n'
  );
  // Insert AFTER child[0].offsets.end, with EOL + indent.
  expect(patch).toEqual({ start: 19, end: 19, newText: '\n    Log("z");' });
});

it('inserts before the first child', () => {
  const children = [stmtAt(10, 19)];
  const patch = insertionPatch(
    { children, bodySpan: { start: 8, end: 22 }, indentText: '    ' },
    0,
    'Log("z");',
    '\n'
  );
  // Insert BEFORE child[0].offsets.start, statement then EOL + indent.
  expect(patch).toEqual({ start: 10, end: 10, newText: 'Log("z");\n    ' });
});

it('computes a full-line deletion range for a statement', () => {
  const src = '  Log("a");\n  Log("b");\n';
  // delete Log("b") at offsets 14..23 → remove its whole line incl. leading indent + trailing EOL
  const patch = deletionPatch(src, { start: 14, end: 23 });
  expect(src.slice(0, patch.start) + src.slice(patch.end)).toBe('  Log("a");\n');
});
