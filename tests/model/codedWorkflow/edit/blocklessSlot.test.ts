/**
 * CRITICAL regression lock (C2): inserting a statement into a BLOCK-LESS
 * control-flow body must be REJECTED.
 *
 * `if (ok) Log("old");` has a block-less then-body — a single statement with no
 * surrounding `{ }`.  Splicing a new statement after it would land OUTSIDE the
 * `if` scope, silently making the inserted line run UNCONDITIONALLY.  Both the
 * before and after sources parse clean, so the syntax parse-gate cannot catch
 * it; the resolver must reject up front based on `slot.braced === false`.
 *
 * This test pins:
 *   1. buildModel marks the block-less then-slot `braced: false` and the braced
 *      one `braced: true` (the signal the resolver keys off).
 *   2. resolveEdit REJECTS an addStatement into the block-less slot with the
 *      exact unbraced-body error (src/model/codedWorkflow/edit/resolveEdit.ts).
 *   3. resolveEdit ACCEPTS an addStatement into the braced slot.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';
import type { CwContainer } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(src: string) {
  const tree = (await getCSharpParser()).parse(src);
  try {
    return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
  } finally {
    tree.delete();
  }
}

const BLOCKLESS = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    if (ok) Log("old");',
  '  }',
  '}'
].join('\n');

const BRACED = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    if (ok) { Log("old"); }',
  '  }',
  '}'
].join('\n');

/** The single `if` container at the top of Execute(). */
function ifContainer(src: string, model: Awaited<ReturnType<typeof modelOf>>): CwContainer {
  const node = model.classes[0].entryPoints[0].body[0];
  if (node.type !== 'container') throw new Error(`${src}: expected an if container`);
  return node;
}

describe('C2 — block-less control-flow body', () => {
  it('buildModel marks the block-less then-slot braced:false', async () => {
    const model = await modelOf(BLOCKLESS);
    const ifc = ifContainer(BLOCKLESS, model);
    const then = ifc.slots.find((s) => s.role === 'then')!;
    expect(then.braced).toBe(false);
  });

  it('buildModel marks the braced then-slot braced:true', async () => {
    const model = await modelOf(BRACED);
    const ifc = ifContainer(BRACED, model);
    const then = ifc.slots.find((s) => s.role === 'then')!;
    expect(then.braced).toBe(true);
  });

  it('REJECTS an addStatement into the block-less then-slot', async () => {
    const model = await modelOf(BLOCKLESS);
    const ifc = ifContainer(BLOCKLESS, model);
    const res = resolveEdit(BLOCKLESS, model, {
      kind: 'addStatement',
      slot: { containerId: ifc.id, methodId: '', role: 'then' },
      index: 1,
      source: 'Log("new");'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(
      'cannot insert into an unbraced control-flow body — convert it to a { } block first'
    );
  });

  it('ACCEPTS an addStatement into the braced then-slot', async () => {
    const model = await modelOf(BRACED);
    const ifc = ifContainer(BRACED, model);
    const res = resolveEdit(BRACED, model, {
      kind: 'addStatement',
      slot: { containerId: ifc.id, methodId: '', role: 'then' },
      index: 1,
      source: 'Log("new");'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyPatches(BRACED, res.patches);
    // The new statement lands inside the braces, after the existing one.
    expect(after).toContain('Log("old");');
    expect(after).toContain('Log("new");');
    // And it reparses without introducing a syntax error.
    const tree = (await getCSharpParser()).parse(after);
    try {
      expect(tree.rootNode.hasError).toBe(false);
    } finally {
      tree.delete();
    }
  });
});
