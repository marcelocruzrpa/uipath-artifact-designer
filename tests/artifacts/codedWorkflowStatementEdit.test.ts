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
  it('appends a statement at the end of the body', async () => {
    const res = await computeAddStatement(SRC, {
      type: 'addStatement',
      slot: { containerId: '', methodId: 'W#Execute/' },
      index: 2,
      source: 'Log("c");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after).toBe([
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    Log("a");',
      '    Log("b");',
      '    Log("c");',
      '  }',
      '}'
    ].join('\n'));
  });

  it('REJECTS an add into a block-less control-flow body', async () => {
    const blockless = [
      'class W : CodedWorkflow {',
      '  [Workflow] public void Execute() {',
      '    if (ok) Log("old");',
      '  }',
      '}'
    ].join('\n');
    // Resolve the if container id via the resolver path: it is the first body
    // child, id `W#Execute/0`.
    const res = await computeAddStatement(blockless, {
      type: 'addStatement',
      slot: { containerId: 'W#Execute/0', methodId: '', role: 'then' },
      index: 1,
      source: 'Log("new");'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(
      'cannot insert into an unbraced control-flow body — convert it to a { } block first'
    );
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
