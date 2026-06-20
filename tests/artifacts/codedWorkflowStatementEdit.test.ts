/**
 * Host edit-fn end-to-end coverage for the THREE statement intents and the arg
 * editor: `computeAddStatement`, `computeDeleteStatement`,
 * `computeMoveStatement`, `computeArgEdit`.  These host wrappers (which run the
 * parser, resolve the intent, apply patches, and enforce the parse-gate +
 * statement-count invariants) previously had no end-to-end test of their own —
 * only the pure resolver did.  Each is exercised on a happy path and on a
 * rejection path so the host-level guards are pinned.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../model/codedWorkflow/helpers';
import {
  computeAddStatement,
  computeDeleteStatement,
  computeMoveStatement,
  computeArgEdit
} from '../../src/artifacts/codedWorkflowEdit';

beforeAll(() => configureCSharpParserFromNodeModules());

const SRC = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    Log("a");',
  '    Log("b");',
  '  }',
  '}'
].join('\n');

describe('computeAddStatement (host e2e)', () => {
  const bodySlot = { containerId: '', methodId: 'W#Execute/' };

  it('emits an Assign step HOST-SIDE from the palette item + arg values', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement',
      slot: bodySlot,
      index: 2,
      paletteItemId: 'step:assign',
      argValues: ['c', '42']
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The host built `var c = 42;` from the trusted template — the webview sent
    // only the id + arg values, never the final C#.
    expect(res.after).toBe([
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a");',
      '    Log("b");',
      '    var c = 42;',
      '  }',
      '}'
    ].join('\n'));
  });

  it('emits an Add-item step host-side from its template', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement', slot: bodySlot, index: 2, paletteItemId: 'step:add-item', argValues: ['items', 'x']
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after.includes('items.Add(x);')).toBe(true);
  });

  it('REJECTS an unknown palette item id', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement', slot: bodySlot, index: 2, paletteItemId: 'catalog:nope.nope', argValues: []
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('unknown palette item: catalog:nope.nope');
  });

  it('IGNORES rawText for a non-raw item (cannot smuggle arbitrary code into a catalog/step insert)', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement',
      slot: bodySlot,
      index: 2,
      paletteItemId: 'step:assign',
      argValues: ['x', '1'],
      rawText: 'System.IO.File.Delete("/etc/passwd")'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after.includes('var x = 1;')).toBe(true);
    expect(res.after.includes('File.Delete')).toBe(false);
  });

  it('REJECTS an add into a block-less control-flow body', async () => {
    const blockless = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    if (ok) Log("old");',
      '  }',
      '}'
    ].join('\n');
    // The if container is the first body child, id `W#Execute/0`.
    const res = await computeAddStatement(blockless, {
      type: 'addStatement',
      slot: { containerId: 'W#Execute/0', methodId: '', role: 'then' },
      index: 1,
      paletteItemId: 'raw',
      argValues: [],
      rawText: 'Log("new");'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(
      'cannot insert into an unbraced control-flow body — convert it to a { } block first'
    );
  });

  it('appends AFTER a trailing line comment, keeping it with its own statement (#8)', async () => {
    const src = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a"); // keep with a',
      '  }',
      '}'
    ].join('\n');
    const res = await computeAddStatement(src, {
      type: 'addStatement', slot: bodySlot, index: 1, paletteItemId: 'raw', argValues: [], rawText: 'Log("b");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after).toBe([
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a"); // keep with a',
      '    Log("b");',
      '  }',
      '}'
    ].join('\n'));
  });

  it('REJECTS an index past the end of the slot (no silent clamp-to-append)', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement', slot: bodySlot, index: 999, paletteItemId: 'raw', argValues: [], rawText: 'Log("c");'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('insertion index is past the end of the slot');
  });

  it('REJECTS a multi-statement raw escape (the count invariant is the content gate)', async () => {
    // Arbitrary C# can ONLY enter via the explicit `raw` escape, and the
    // per-intent statement-count invariant still blocks smuggling >1 statement.
    for (const payload of ['Foo(); Evil();', 'Log("x"); system.DeleteEverything();', 'a(); b(); c();']) {
      const res = await computeAddStatement(SRC, {
        type: 'addStatement', slot: bodySlot, index: 2, paletteItemId: 'raw', argValues: [], rawText: payload
      });
      expect(res.ok, `should reject injected payload: ${payload}`).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe('edit changed the statement count unexpectedly');
    }
  });
});

describe('computeDeleteStatement (host e2e)', () => {
  it('deletes a statement by id', async () => {
    const res = await computeDeleteStatement(SRC, { type: 'deleteStatement', id: 'W#Execute/0' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after.includes('Log("a")')).toBe(false);
    expect(res.after.includes('Log("b")')).toBe(true);
  });

  it('REJECTS deleting a statement that carries a trailing // comment', async () => {
    const commented = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a"); // keep me',
      '    Log("b");',
      '  }',
      '}'
    ].join('\n');
    const res = await computeDeleteStatement(commented, { type: 'deleteStatement', id: 'W#Execute/0' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('cannot delete a statement that has a trailing comment');
  });
});

describe('computeMoveStatement (host e2e)', () => {
  it('moves a statement up', async () => {
    const res = await computeMoveStatement(SRC, { type: 'moveStatement', id: 'W#Execute/1', direction: -1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after.indexOf('Log("b")')).toBeLessThan(res.after.indexOf('Log("a")'));
  });

  it('REJECTS moving past the slot boundary', async () => {
    const res = await computeMoveStatement(SRC, { type: 'moveStatement', id: 'W#Execute/0', direction: -1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('cannot move past the slot boundary');
  });
});

describe('computeArgEdit (host e2e)', () => {
  it('adds a trailing argument', async () => {
    const src =
      'class W : CodedWorkflow { [Workflow] public void Execute() { system.AddQueueItem("Q"); } }';
    const res = await computeArgEdit(src, { type: 'editArg', id: 'W#Execute/0', op: 'add', newText: 'item' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after).toBe(
      'class W : CodedWorkflow { [Workflow] public void Execute() { system.AddQueueItem("Q", item); } }'
    );
  });

  it('REJECTS an arg edit that would break the C# syntax', async () => {
    // `change` writes the arg expression verbatim; an unbalanced `(` leaves the
    // call unterminated — caught by the single-expression guard before the gate.
    const src =
      'class W : CodedWorkflow { [Workflow] public void Execute() { system.DoThing("Q", item); } }';
    const res = await computeArgEdit(src, {
      type: 'editArg',
      id: 'W#Execute/0',
      op: 'change',
      argIndex: 1,
      newText: 'Foo('
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('argument must be a single expression');
  });
});
