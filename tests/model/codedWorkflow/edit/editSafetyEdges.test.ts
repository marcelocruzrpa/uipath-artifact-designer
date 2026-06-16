/**
 * Edit-safety EDGE coverage for the pure resolver (resolveEdit + placeStatement
 * + applyPatches), beyond the happy paths already covered in addStatement /
 * deleteStatement / moveStatement / editArg tests:
 *
 *   - CRLF round-trip: add (append + insert-before), delete and move must keep
 *     the document CRLF-consistent (no orphaned `\r`, no bare `\n`) and reparse
 *     with no new error.  `helpers.loadFixture` strips CRLF, so the CRLF source
 *     is built with `\r\n` directly.
 *   - move with a comment/blank line BETWEEN the two siblings: the between-
 *     content is preserved and the result reparses.
 *   - inline same-line deletion: deleting one of two statements that share a
 *     line removes exactly that statement (the line-delete path falls back to
 *     the exact range so it never eats the sibling).
 *   - deeply-nested / repeatable slot: delete + move inside a doubly-nested
 *     container, and an add/move targeting a SECOND catch (roleIndex 1).
 *   - positional-after-named editArg add → rejected.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwContainer
} from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(src: string): Promise<CodedWorkflowModel> {
  const tree = (await getCSharpParser()).parse(src);
  try {
    return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
  } finally {
    tree.delete();
  }
}

async function reparseHasError(src: string): Promise<boolean> {
  const tree = (await getCSharpParser()).parse(src);
  try {
    return tree.rootNode.hasError;
  } finally {
    tree.delete();
  }
}

/** No bare `\n` (every `\n` is preceded by `\r`) and no orphan `\r`. */
function isCrlfConsistent(text: string): boolean {
  return !/[^\r]\n/.test(text) && !/^\n/.test(text) && !/\r[^\n]/.test(text) && !/\r$/.test(text);
}

// ---------------------------------------------------------------------------
// (4) CRLF round-trip
// ---------------------------------------------------------------------------

const CRLF = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    Log("a");',
  '    Log("b");',
  '    Log("c");',
  '  }',
  '}'
].join('\r\n');

describe('CRLF round-trip', () => {
  it('append keeps CRLF consistent and reparses clean', async () => {
    const model = await modelOf(CRLF);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(CRLF, model, {
      kind: 'addStatement',
      slot: { containerId: '', methodId: 'W#Execute/' },
      index: ep.body.length,
      source: 'Log("d");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(CRLF, res.patches);
    expect(isCrlfConsistent(after)).toBe(true);
    expect(after.includes('\r\n    Log("d");')).toBe(true);
    expect(await reparseHasError(after)).toBe(false);
  });

  it('insert-before-first keeps CRLF consistent', async () => {
    const model = await modelOf(CRLF);
    const res = resolveEdit(CRLF, model, {
      kind: 'addStatement',
      slot: { containerId: '', methodId: 'W#Execute/' },
      index: 0,
      source: 'Log("z");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(CRLF, res.patches);
    expect(isCrlfConsistent(after)).toBe(true);
    expect(await reparseHasError(after)).toBe(false);
  });

  it('delete keeps CRLF consistent (no orphaned \\r)', async () => {
    const model = await modelOf(CRLF);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(CRLF, model, { kind: 'deleteStatement', id: ep.body[1].id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(CRLF, res.patches);
    expect(isCrlfConsistent(after)).toBe(true);
    expect(after.includes('Log("b")')).toBe(false);
    expect(await reparseHasError(after)).toBe(false);
  });

  it('move-down keeps CRLF consistent', async () => {
    const model = await modelOf(CRLF);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(CRLF, model, { kind: 'moveStatement', id: ep.body[0].id, direction: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(CRLF, res.patches);
    expect(isCrlfConsistent(after)).toBe(true);
    // a and b swapped: b now precedes a.
    expect(after.indexOf('Log("b")')).toBeLessThan(after.indexOf('Log("a")'));
    expect(await reparseHasError(after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (5) move with comment/blank line BETWEEN the siblings
// ---------------------------------------------------------------------------

describe('move with content between siblings', () => {
  it('preserves a comment + blank line between the swapped statements', async () => {
    const src = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a");',
      '    // a comment',
      '',
      '    Log("b");',
      '  }',
      '}'
    ].join('\n');
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    // The comment + blank line sit BETWEEN two activity statements (they are not
    // trailing same-line comments), so the swap is allowed and the between-
    // content stays put while only the two statements exchange positions.
    const res = resolveEdit(src, model, { kind: 'moveStatement', id: ep.body[0].id, direction: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(src, res.patches);
    expect(after).toBe([
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("b");',
      '    // a comment',
      '',
      '    Log("a");',
      '  }',
      '}'
    ].join('\n'));
    expect(await reparseHasError(after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (6) inline same-line deletion
// ---------------------------------------------------------------------------

describe('inline same-line deletion', () => {
  it('removes only the targeted statement of two on one line', async () => {
    const src =
      'class W : CodedWorkflow { [Workflow] public void Execute() { Log("a"); Log("b"); } }';
    const model = await modelOf(src);
    const ep = model.classes[0].entryPoints[0];
    const res = resolveEdit(src, model, { kind: 'deleteStatement', id: ep.body[1].id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(src, res.patches);
    // The exact-range fallback removes only `Log("b");` — the first statement and
    // the separating space are untouched, so the sibling is never eaten.
    expect(after).toBe(
      'class W : CodedWorkflow { [Workflow] public void Execute() { Log("a");  } }'
    );
    expect(after.includes('Log("b")')).toBe(false);
    expect(await reparseHasError(after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (9) deeply-nested + repeatable (roleIndex 1) slots
// ---------------------------------------------------------------------------

const NESTED = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    if (a) {',
  '      if (b) {',
  '        Log("deep1");',
  '        Log("deep2");',
  '      }',
  '    }',
  '  }',
  '}'
].join('\n');

describe('deeply-nested container edits', () => {
  it('deletes a statement two containers deep', async () => {
    const model = await modelOf(NESTED);
    const outer = model.classes[0].entryPoints[0].body[0] as CwContainer;
    const inner = outer.slots[0].children[0] as CwContainer;
    const deep1 = inner.slots[0].children[0].id;
    expect(deep1).toBe('W#Execute/0.then.0.then.0');
    const res = resolveEdit(NESTED, model, { kind: 'deleteStatement', id: deep1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(NESTED, res.patches);
    expect(after.includes('Log("deep1")')).toBe(false);
    expect(after.includes('Log("deep2")')).toBe(true);
    expect(await reparseHasError(after)).toBe(false);
  });

  it('moves a statement two containers deep', async () => {
    const model = await modelOf(NESTED);
    const outer = model.classes[0].entryPoints[0].body[0] as CwContainer;
    const inner = outer.slots[0].children[0] as CwContainer;
    const deep2 = inner.slots[0].children[1].id;
    const res = resolveEdit(NESTED, model, { kind: 'moveStatement', id: deep2, direction: -1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(NESTED, res.patches);
    // deep2 moves above deep1.
    expect(after.indexOf('Log("deep2")')).toBeLessThan(after.indexOf('Log("deep1")'));
    expect(await reparseHasError(after)).toBe(false);
  });
});

const TWO_CATCH = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    try { Log("t"); }',
  '    catch (IOException e1) { Log("c1"); }',
  '    catch (Exception e2) { Log("c2"); }',
  '  }',
  '}'
].join('\n');

describe('repeatable slot — second catch (roleIndex 1)', () => {
  it('targets the SECOND catch body for an add', async () => {
    const model = await modelOf(TWO_CATCH);
    const tryC = model.classes[0].entryPoints[0].body[0] as CwContainer;
    const catches = tryC.slots.filter((s) => s.role === 'catch');
    expect(catches).toHaveLength(2);
    // The second catch's child id carries the catch1 occurrence segment.
    expect(catches[1].children[0].id).toBe('W#Execute/0.catch1.0');
    const res = resolveEdit(TWO_CATCH, model, {
      kind: 'addStatement',
      slot: { containerId: tryC.id, methodId: '', role: 'catch', roleIndex: 1 },
      index: 1,
      source: 'Log("new");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(TWO_CATCH, res.patches);
    // The new line lands in the e2 (second) catch, after Log("c2").
    expect(after).toContain('Log("c2");');
    expect(after).toContain('Log("new");');
    expect(after.indexOf('Log("new")')).toBeGreaterThan(after.indexOf('Log("c2")'));
    expect(await reparseHasError(after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (10) positional-after-named rejection
// ---------------------------------------------------------------------------

describe('editArg add after a named argument', () => {
  it('REJECTS appending a positional arg when an existing arg is named', async () => {
    const src =
      'class W : CodedWorkflow { [Workflow] public void Execute() { system.DoThing(foo: "x"); } }';
    const model = await modelOf(src);
    const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
    const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: 'bar' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('cannot append a positional argument after a named argument');
  });
});
