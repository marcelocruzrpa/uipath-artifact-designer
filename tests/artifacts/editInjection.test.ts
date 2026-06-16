/**
 * CRITICAL regression lock (C1): the host edit helpers must REJECT raw-text
 * injection through a value/arg edit — a non-string field is spliced verbatim,
 * so a payload that closes the call's paren early and smuggles extra statements
 * (`other); Evil(); Log(item`) would otherwise inject code that BOTH parses
 * clean and keeps the surrounding file well-formed.  `computeValueEdit` /
 * `computeArgEdit` defend against this with the single-expression guard
 * (`parsesAsSingleExpression`) plus the statement-count / type-preservation
 * backstops.  These tests pin the ACTUAL rejection error strings the committed
 * implementation returns, and confirm the legitimate edits still succeed, so the
 * guards can never silently regress.
 *
 * The error strings asserted here are produced by:
 *   src/artifacts/codedWorkflowEdit.ts  (computeValueEdit / computeArgEdit)
 * — see `parsesAsSingleExpression` and the type-preservation guard.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../model/codedWorkflow/helpers';
import { getCSharpParser } from '../../src/model/codedWorkflow/parser';
import { buildModel } from '../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../src/model/codedWorkflow/cwTypes';
import { computeValueEdit, computeArgEdit } from '../../src/artifacts/codedWorkflowEdit';

beforeAll(() => configureCSharpParserFromNodeModules());

const wrap = (s: string) =>
  `class W : CodedWorkflow { [Workflow] public void Execute() { ${s} } }`;

/** Build the model the same way the host helper does and read the first card. */
async function firstCard(source: string): Promise<CwActivityCard> {
  const tree = (await getCSharpParser()).parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
    return model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  } finally {
    tree.delete();
  }
}

// `system.SetTransactionStatus(item)` surfaces arg 0 as an IDENTIFIER (editable,
// written verbatim — the dangerous, non-string path).  `system.DoThing(40)`
// surfaces a NUMBER literal; `system.DoThing(a + b)` a raw binary expression.

describe('editValue raw-injection rejection (C1)', () => {
  it('REJECTS a non-string newText that smuggles extra statements', async () => {
    const src = wrap('system.SetTransactionStatus(item);');
    const card = await firstCard(src);
    // `other); Evil(); Log(item` closes the paren early and parses to THREE
    // statements when wrapped — the single-expression guard rejects it before
    // it can be spliced verbatim into the document.
    const res = await computeValueEdit(src, {
      type: 'editValue',
      id: card.id,
      argIndex: 0,
      newText: 'other); Evil(); Log(item'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('value must be a single expression');
  });

  it('REJECTS a number-literal field morphed into an expression (40 → 40 + 2)', async () => {
    const src = wrap('system.DoThing(40);');
    const card = await firstCard(src);
    // `40 + 2` is a single well-formed expression (passes the parse-gate AND
    // the single-expression guard), but it morphs an `integer_literal` (number)
    // into a `binary_expression` (raw) — caught by the type-preservation guard.
    const res = await computeValueEdit(src, {
      type: 'editValue',
      id: card.id,
      argIndex: 0,
      newText: '40 + 2'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('edit changed the value type (e.g. a string lost its quotes)');
  });

  it('ACCEPTS an identifier→identifier edit (item → other)', async () => {
    const src = wrap('system.SetTransactionStatus(item);');
    const card = await firstCard(src);
    const res = await computeValueEdit(src, {
      type: 'editValue',
      id: card.id,
      argIndex: 0,
      newText: 'other'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after).toBe(wrap('system.SetTransactionStatus(other);'));
  });

  it('ACCEPTS a binary-expression operand edit (a + b → a + c)', async () => {
    const src = wrap('system.DoThing(a + b);');
    const card = await firstCard(src);
    // The backing node stays a `binary_expression` (editableKind 'raw'), so both
    // the editableKind and syntactic-type guards are satisfied — operand edits
    // of a raw expression are legitimate.
    const res = await computeValueEdit(src, {
      type: 'editValue',
      id: card.id,
      argIndex: 0,
      newText: 'a + c'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.after).toBe(wrap('system.DoThing(a + c);'));
  });
});

describe('editArg raw-injection rejection (C1)', () => {
  it('REJECTS an add whose newText smuggles statements (x); Evil(); Log(', async () => {
    const src = wrap('system.AddQueueItem("Q");');
    const card = await firstCard(src);
    const res = await computeArgEdit(src, {
      type: 'editArg',
      id: card.id,
      op: 'add',
      newText: 'x); Evil(); Log('
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('argument must be a single expression');
  });

  it('REJECTS a change whose newText smuggles a second statement', async () => {
    const src = wrap('system.DoThing("Q", item);');
    const card = await firstCard(src);
    const res = await computeArgEdit(src, {
      type: 'editArg',
      id: card.id,
      op: 'change',
      argIndex: 1,
      newText: 'item); Evil(); Log(x'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('argument must be a single expression');
  });
});
