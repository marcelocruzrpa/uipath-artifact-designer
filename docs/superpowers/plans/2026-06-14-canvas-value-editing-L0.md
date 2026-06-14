# Canvas Value-Editing (L0 / M5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer select an activity card on the canvas and edit its leaf *values* (string/number/bool literals, enum members, the result-binding name); the change writes back to the `.cs` as a minimal `WorkspaceEdit` at the value's exact source span, with native undo and a parse-gate.

**Architecture:** The webview never writes — it emits a typed `editValue` intent to the host. A pure `resolveEdit(source, model, intent)` computes a minimal `TextPatch` (char-offset range + new text); a pure parse-gate re-parses the patched string and rejects edits that introduce a new syntax error; the host applies a `vscode.WorkspaceEdit`, and the existing live-reload loop re-parses and re-renders. Read-only stays the default; an edit-mode toggle opts in.

**Tech Stack:** TypeScript, web-tree-sitter (C# grammar), vitest, esbuild, plain-DOM webview. Surgical-patch write-back (design spec `docs/superpowers/specs/2026-06-14-canvas-code-editing-design.md`, decision A).

**Reference reading before starting:**
- `docs/superpowers/specs/2026-06-14-canvas-code-editing-design.md` — the approved design.
- `src/model/codedWorkflow/cwTypes.ts` — the IR (`CwArgSummary`, `SourceSpan`, `CwActivityCard`, `CwStatement`).
- `src/model/codedWorkflow/classify/argExtract.ts` — where arg summaries are built (this is where value spans get captured).
- `src/util/messages.ts` + `src/util/validateMessage.ts` + `tests/util/messageContractParity.test.ts` — the closed message unions + the parity gate that forces validator updates.
- `tests/model/codedWorkflow/tier2Golden.test.ts` — the golden-harness pattern the edit tests mirror.
- `src/artifactEditorProvider.ts` — the host message handler + the live-reload loop with the `lastWrittenText` echo-guard.

---

## File Structure

**Create:**
- `src/model/codedWorkflow/edit/editTypes.ts` — `EditIntent`, `TextPatch`, `EditResult`, `EditError` (pure, JSON-serializable shapes).
- `src/model/codedWorkflow/edit/resolveEdit.ts` — dispatcher: `resolveEdit(source, model, intent)`.
- `src/model/codedWorkflow/edit/editValue.ts` — the L0 value-edit resolver.
- `src/model/codedWorkflow/edit/parseGate.ts` — `wouldParseClean(patchedSource, parser)`.
- `src/model/codedWorkflow/edit/findNode.ts` — locate a `CwStatement` by `id` within a model.
- `webview/renderers/codedWorkflow/propertiesPanel.ts` — the docked properties panel.
- Tests: `tests/model/codedWorkflow/edit/{editValue,parseGate,findNode}.test.ts`, `tests/model/codedWorkflow/argValueSpan.test.ts`, `tests/webview/propertiesPanel.test.ts`.

**Modify:**
- `src/model/codedWorkflow/cwTypes.ts` — add `valueSpan` (char offsets) to `CwArgSummary`; add `editableKind` discriminator.
- `src/model/codedWorkflow/classify/argExtract.ts` — populate `valueSpan` + `editableKind` from the arg node.
- `src/util/messages.ts` — add `EditValueMessage` to the webview→host union; add `editing?: boolean` to `WebviewViewState`.
- `src/util/validateMessage.ts` — validator for `editValue`; extend `isViewState`.
- `tests/util/messageContractParity.test.ts` (+ any message fixtures) — cover the new message.
- `src/artifactEditorProvider.ts` — handle `editValue`: `resolveEdit` → parse-gate → `WorkspaceEdit`.
- `webview/renderers/codedWorkflowRenderer.ts` — selection wiring + edit-mode toggle + mount the panel + post intents.
- `webview/styles/codedWorkflow.css` — panel styles (no `innerHTML`).

---

## Task 1: Capture per-value source spans in the model

The model spans every node but not individual argument values. Add a char-offset span + an editability discriminator to each `CwArgSummary` so an edit can target an exact byte range.

**Files:**
- Modify: `src/model/codedWorkflow/cwTypes.ts`
- Modify: `src/model/codedWorkflow/classify/argExtract.ts`
- Test: `tests/model/codedWorkflow/argValueSpan.test.ts`

- [ ] **Step 1: Extend the IR type**

In `cwTypes.ts`, add to `CwArgSummary` (keep existing `label`, `value`, `kind`):

```ts
/** Char offsets (0-based, into the file) of the rendered value's exact source. */
export interface OffsetSpan { start: number; end: number; }

export interface CwArgSummary {
  label: string;
  value: string;
  kind: 'literal' | 'interpolated' | 'identifier' | 'target' | 'expression';
  /** Exact source range of the VALUE token(s); absent when the value is synthesized. */
  valueSpan?: OffsetSpan;
  /**
   * How the value may be edited from a form:
   *   'string'|'number'|'bool'|'enum' → typed field; 'identifier' → text field;
   *   'raw' → raw-text only (expression/interpolated); 'none' → read-only.
   */
  editableKind: 'string' | 'number' | 'bool' | 'enum' | 'identifier' | 'raw' | 'none';
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/model/codedWorkflow/argValueSpan.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

it('captures the value span + editableKind of a Log message literal', async () => {
  const source =
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
    const arg = card.args[0];
    expect(arg.editableKind).toBe('string');
    expect(arg.valueSpan).toBeDefined();
    // The captured span must slice back to the exact literal, quotes included.
    expect(source.slice(arg.valueSpan!.start, arg.valueSpan!.end)).toBe('"hi"');
  } finally {
    tree.delete();
  }
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run tests/model/codedWorkflow/argValueSpan.test.ts`
Expected: FAIL — `editableKind`/`valueSpan` undefined.

- [ ] **Step 4: Populate the fields in argExtract**

In `argExtract.ts`, wherever a `CwArgSummary` is built from an arg node, set `valueSpan` from the node's `startIndex`/`endIndex` and map the node type to `editableKind`:

```ts
function editableKindOf(node: Node): CwArgSummary['editableKind'] {
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal': return 'string';
    case 'integer_literal':
    case 'real_literal': return 'number';
    case 'boolean_literal': return 'bool';
    case 'member_access_expression': // e.g. SearchOption.AllDirectories
      return 'enum';
    case 'identifier': return 'identifier';
    case 'interpolated_string_expression': return 'raw';
    default: return 'raw';
  }
}
// when building the summary for `valueNode`:
//   valueSpan: { start: valueNode.startIndex, end: valueNode.endIndex },
//   editableKind: editableKindOf(valueNode),
```
Synthesized/derived values (no backing node) keep `editableKind: 'none'` and omit `valueSpan`.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/model/codedWorkflow/argValueSpan.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate golden model snapshots**

The new fields change `goldenModels` snapshots. Run: `npx vitest run -u tests/model/codedWorkflow/goldenModels.test.ts` then eyeball the diff (only `valueSpan`/`editableKind` added). Run the full suite: `npx vitest run` — expected GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/model/codedWorkflow/cwTypes.ts src/model/codedWorkflow/classify/argExtract.ts tests/
git commit -m "feat(edit): capture per-value source spans + editableKind on CwArgSummary"
```

---

## Task 2: Edit intent + patch types (pure shapes)

**Files:**
- Create: `src/model/codedWorkflow/edit/editTypes.ts`
- Test: (none — types only; exercised by Task 3-4)

- [ ] **Step 1: Define the shapes**

```ts
// src/model/codedWorkflow/edit/editTypes.ts
// PURITY: no vscode/fs/path/node:* imports.

/** A minimal text replacement: replace [start,end) char offsets with newText. */
export interface TextPatch { start: number; end: number; newText: string; }

/** L0 intent: change one argument's value on the node identified by `id`. */
export interface EditValueIntent {
  kind: 'editValue';
  /** Stable node id (`${className}#${method}/<path>`). */
  id: string;
  /** Index into the node's `args` array. */
  argIndex: number;
  /** The new value, EXACT source text the user wants (e.g. `"Begin"`, `42`, `true`). */
  newText: string;
}

export type EditIntent = EditValueIntent; // L1/L2 widen this union

export type EditResult =
  | { ok: true; patches: TextPatch[] }
  | { ok: false; error: string };
```

- [ ] **Step 2: Commit**

```bash
git add src/model/codedWorkflow/edit/editTypes.ts
git commit -m "feat(edit): edit-intent + text-patch types"
```

---

## Task 3: `findNode` + `editValue` resolver (pure, golden-tested)

**Files:**
- Create: `src/model/codedWorkflow/edit/findNode.ts`
- Create: `src/model/codedWorkflow/edit/editValue.ts`
- Create: `src/model/codedWorkflow/edit/resolveEdit.ts`
- Test: `tests/model/codedWorkflow/edit/editValue.test.ts`

- [ ] **Step 1: Write the failing test (golden-style: source + intent → resulting source)**

```ts
// tests/model/codedWorkflow/edit/editValue.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import type { CwActivityCard } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(source: string) {
  const tree = (await getCSharpParser()).parse(source);
  try { return buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}
function applyPatches(source: string, patches: { start: number; end: number; newText: string }[]) {
  // Apply right-to-left so earlier offsets stay valid.
  return [...patches].sort((a, b) => b.start - a.start)
    .reduce((s, p) => s.slice(0, p.start) + p.newText + s.slice(p.end), source);
}

it('edits a Log message literal in place, touching only its span', async () => {
  const source =
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 0, newText: '"bye"' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(source, res.patches)).toBe(
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("bye"); } }'
  );
});

it('rejects editing a value with no captured span', async () => {
  const source =
    'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const model = await modelOf(source);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(source, model, { kind: 'editValue', id: card.id, argIndex: 99, newText: 'x' });
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/model/codedWorkflow/edit/editValue.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `findNode`**

```ts
// src/model/codedWorkflow/edit/findNode.ts
import type { CodedWorkflowModel, CwStatement } from '../cwTypes';

/** Depth-first search for a statement by id, descending container slots. */
export function findNodeById(model: CodedWorkflowModel, id: string): CwStatement | null {
  const walk = (stmts: CwStatement[]): CwStatement | null => {
    for (const s of stmts) {
      if (s.id === id) return s;
      if (s.type === 'container') {
        for (const slot of s.slots) { const hit = walk(slot.children); if (hit) return hit; }
      }
    }
    return null;
  };
  for (const cls of model.classes)
    for (const ep of cls.entryPoints) { const hit = walk(ep.body); if (hit) return hit; }
  return null;
}
```

- [ ] **Step 4: Implement `editValue`**

```ts
// src/model/codedWorkflow/edit/editValue.ts
import type { CodedWorkflowModel } from '../cwTypes';
import type { EditValueIntent, EditResult } from './editTypes';
import { findNodeById } from './findNode';

export function editValue(
  _source: string, model: CodedWorkflowModel, intent: EditValueIntent
): EditResult {
  const node = findNodeById(model, intent.id);
  if (node === null) return { ok: false, error: `node not found: ${intent.id}` };
  if (node.type !== 'activity' && node.type !== 'pseudo')
    return { ok: false, error: `node ${intent.id} has no editable args` };
  // Only activity cards carry args in L0 (pseudo handled in L1).
  if (node.type !== 'activity') return { ok: false, error: 'pseudo-step editing is L1' };
  const arg = node.args[intent.argIndex];
  if (arg === undefined || arg.valueSpan === undefined || arg.editableKind === 'none')
    return { ok: false, error: `arg ${intent.argIndex} is not editable` };
  return { ok: true, patches: [{ start: arg.valueSpan.start, end: arg.valueSpan.end, newText: intent.newText }] };
}
```

- [ ] **Step 5: Implement the dispatcher `resolveEdit`**

```ts
// src/model/codedWorkflow/edit/resolveEdit.ts
import type { CodedWorkflowModel } from '../cwTypes';
import type { EditIntent, EditResult } from './editTypes';
import { editValue } from './editValue';

export function resolveEdit(
  source: string, model: CodedWorkflowModel, intent: EditIntent
): EditResult {
  switch (intent.kind) {
    case 'editValue': return editValue(source, model, intent);
    default: return { ok: false, error: `unsupported edit: ${(intent as { kind: string }).kind}` };
  }
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/model/codedWorkflow/edit/editValue.test.ts`
Expected: PASS (both).

- [ ] **Step 7: Commit**

```bash
git add src/model/codedWorkflow/edit/ tests/model/codedWorkflow/edit/editValue.test.ts
git commit -m "feat(edit): pure editValue resolver + findNode (golden-tested)"
```

---

## Task 4: Parse-gate (pure)

Reject any patch that introduces a *new* syntax error versus the pre-edit tree.

**Files:**
- Create: `src/model/codedWorkflow/edit/parseGate.ts`
- Test: `tests/model/codedWorkflow/edit/parseGate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/model/codedWorkflow/edit/parseGate.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { introducesNewError } from '../../../../src/model/codedWorkflow/edit/parseGate';

beforeAll(() => configureCSharpParserFromNodeModules());

const wrap = (s: string) => `class W : CodedWorkflow { [Workflow] public void Execute() { ${s} } }`;

it('accepts a well-formed edit', async () => {
  const parser = await getCSharpParser();
  expect(introducesNewError(parser, wrap('Log("hi");'), wrap('Log("bye");'))).toBe(false);
});

it('rejects an edit that breaks the syntax', async () => {
  const parser = await getCSharpParser();
  expect(introducesNewError(parser, wrap('Log("hi");'), wrap('Log("bye);'))).toBe(true);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/model/codedWorkflow/edit/parseGate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gate**

```ts
// src/model/codedWorkflow/edit/parseGate.ts
import type { CSharpParserHandle } from '../parser';

function hasError(parser: CSharpParserHandle, source: string): boolean {
  const tree = parser.parse(source);
  try { return tree.rootNode.hasError; } finally { tree.delete(); }
}

/** True when `after` parses with an error that `before` did not have. */
export function introducesNewError(
  parser: CSharpParserHandle, before: string, after: string
): boolean {
  return hasError(parser, after) && !hasError(parser, before);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/model/codedWorkflow/edit/parseGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/codedWorkflow/edit/parseGate.ts tests/model/codedWorkflow/edit/parseGate.test.ts
git commit -m "feat(edit): parse-gate rejects edits that introduce new syntax errors"
```

---

## Task 5: Message contract — `editValue` + `editing` view-state

**Files:**
- Modify: `src/util/messages.ts`
- Modify: `src/util/validateMessage.ts`
- Test: `tests/util/messageContractParity.test.ts` (+ existing validate tests)

- [ ] **Step 1: Add the message + view-state field**

In `messages.ts`, add to the webview→host union and `WebviewViewState`:

```ts
export interface EditValueMessage {
  type: 'editValue';
  id: string;
  argIndex: number;
  newText: string;
}
// add `EditValueMessage` to the WebviewToHost union type.
// In WebviewViewState add:  editing?: boolean;
```

- [ ] **Step 2: Write the failing validator test**

```ts
// add to tests/util/validateMessage.test.ts (or the existing validate spec)
import { isWebviewToHost } from '../../src/util/validateMessage';
it('accepts a well-formed editValue message', () => {
  expect(isWebviewToHost({ type: 'editValue', id: 'W#Execute/0', argIndex: 0, newText: '"x"' })).toBe(true);
});
it('rejects an editValue missing argIndex', () => {
  expect(isWebviewToHost({ type: 'editValue', id: 'W#Execute/0', newText: '"x"' })).toBe(false);
});
```

- [ ] **Step 3: Run it / confirm fail**

Run: `npx vitest run tests/util/` — Expected: FAIL (validator doesn't know `editValue`) and the **parity test** also fails (forces you to update the validator).

- [ ] **Step 4: Implement the validator**

In `validateMessage.ts`, add an `editValue` branch:

```ts
case 'editValue':
  return typeof m.id === 'string'
    && typeof m.argIndex === 'number' && Number.isInteger(m.argIndex)
    && typeof m.newText === 'string';
```
And in `isViewState`, allow optional `editing`: `(m.editing === undefined || typeof m.editing === 'boolean')`.

- [ ] **Step 5: Run the suite / confirm pass**

Run: `npx vitest run tests/util/` — Expected: PASS, including `messageContractParity`.

- [ ] **Step 6: Commit**

```bash
git add src/util/messages.ts src/util/validateMessage.ts tests/util/
git commit -m "feat(edit): editValue message contract + editing view-state"
```

---

## Task 6: Host handler — apply the edit as a WorkspaceEdit

**Files:**
- Modify: `src/artifactEditorProvider.ts`
- Test: manual (host code needs the vscode runtime); the pure path is already covered by Tasks 3-4.

- [ ] **Step 1: Add the handler in the webview message switch**

Where the provider handles incoming webview messages (near the existing `openResource` handler), add:

```ts
case 'editValue': {
  await this.applyValueEdit(document, message);
  break;
}
```

- [ ] **Step 2: Implement `applyValueEdit`**

```ts
private async applyValueEdit(
  document: vscode.TextDocument,
  message: EditValueMessage
): Promise<void> {
  const model = this.lastModelFor(document.uri); // the model already built for this doc
  if (!model || model.kind !== 'coded-workflow') return;
  const source = document.getText();
  const res = resolveEdit(source, model, {
    kind: 'editValue', id: message.id, argIndex: message.argIndex, newText: message.newText
  });
  if (!res.ok) { vscode.window.showWarningMessage(`Edit rejected: ${res.error}`); return; }

  const parser = await getCSharpParser();
  const after = applyPatches(source, res.patches); // same right-to-left applier as the test
  if (introducesNewError(parser, source, after)) {
    vscode.window.showWarningMessage('Edit rejected: it would break the C# syntax.');
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const p of res.patches) {
    edit.replace(document.uri,
      new vscode.Range(document.positionAt(p.start), document.positionAt(p.end)), p.newText);
  }
  this.markSelfWrite(document.uri, after); // reuse the lastWrittenText echo-guard
  await vscode.workspace.applyEdit(edit);
}
```
Notes for the implementer: `lastModelFor`, `markSelfWrite`, and `applyPatches` may need small extraction — `lastWrittenText` already exists as the echo-guard; expose a setter if it's private. Keep `applyPatches` in a shared `edit/applyPatches.ts` so host and tests share it (move it out of the test file).

- [ ] **Step 3: Extract `applyPatches` to a shared module + unit-test it**

Create `src/model/codedWorkflow/edit/applyPatches.ts` with the right-to-left applier from Task 3, add `tests/model/codedWorkflow/edit/applyPatches.test.ts` (two overlapping-safe patches → correct result), and import it in both the host and the editValue test.

- [ ] **Step 4: Build + bundle-smoke (host code is bundled)**

Run: `npm run typecheck && npm run smoke && npm run build:prod`
Expected: typecheck clean, `[smoke] PASS`, build complete.

- [ ] **Step 5: Commit**

```bash
git add src/artifactEditorProvider.ts src/model/codedWorkflow/edit/applyPatches.ts tests/
git commit -m "feat(edit): host applies value edits via WorkspaceEdit behind the parse-gate"
```

---

## Task 7: Properties panel (webview) — read first, then edit

**Files:**
- Create: `webview/renderers/codedWorkflow/propertiesPanel.ts`
- Modify: `webview/renderers/codedWorkflowRenderer.ts`
- Modify: `webview/styles/codedWorkflow.css`
- Test: `tests/webview/propertiesPanel.test.ts`

- [ ] **Step 1: Write the failing panel test**

```ts
// tests/webview/propertiesPanel.test.ts  (jsdom)
import { describe, it, expect, vi } from 'vitest';
import { renderPropertiesPanel } from '../../webview/renderers/codedWorkflow/propertiesPanel';
import type { CwActivityCard } from '../../src/model/codedWorkflow/cwTypes';

const card: CwActivityCard = {
  id: 'W#Execute/0', type: 'activity', tier: 1, service: '_base', serviceDisplayName: 'Workflow',
  method: 'Log', title: 'Log', icon: 'play-circle',
  span: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  args: [{ label: 'Message', value: '"hi"', kind: 'literal',
           valueSpan: { start: 1, end: 5 }, editableKind: 'string' }]
};

it('renders an editable field and emits editValue on commit', () => {
  const onEdit = vi.fn();
  const root = document.createElement('div');
  root.appendChild(renderPropertiesPanel(card, { editing: true, onEdit }));
  const input = root.querySelector('input') as HTMLInputElement;
  expect(input.value).toBe('"hi"');
  input.value = '"bye"';
  input.dispatchEvent(new Event('change'));
  expect(onEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', argIndex: 0, newText: '"bye"' });
});

it('renders disabled fields in read-only mode', () => {
  const root = document.createElement('div');
  root.appendChild(renderPropertiesPanel(card, { editing: false, onEdit: () => {} }));
  expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
});
```

- [ ] **Step 2: Run / confirm fail**

Run: `npx vitest run tests/webview/propertiesPanel.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the panel (DOM helpers only — NO innerHTML)**

```ts
// webview/renderers/codedWorkflow/propertiesPanel.ts
import { el, clearChildren } from '../../util';
import type { CwActivityCard, CwArgSummary } from '../../../src/model/codedWorkflow/cwTypes';

export interface PanelOptions {
  editing: boolean;
  onEdit: (intent: { id: string; argIndex: number; newText: string }) => void;
}

export function renderPropertiesPanel(card: CwActivityCard, opts: PanelOptions): HTMLElement {
  const panel = el('div', 'cw-props');
  panel.appendChild(el('div', 'cw-props-title', card.title));
  card.args.forEach((arg, argIndex) => {
    const row = el('div', 'cw-props-row');
    row.appendChild(el('label', 'cw-props-label', arg.label));
    const input = document.createElement('input');
    input.className = 'cw-props-input';
    input.value = arg.value;
    input.disabled = !opts.editing || arg.editableKind === 'none' || arg.valueSpan === undefined;
    if (arg.editableKind === 'raw') input.title = 'expression — edits are raw text';
    input.addEventListener('change', () => opts.onEdit({ id: card.id, argIndex, newText: input.value }));
    row.appendChild(input);
    panel.appendChild(row);
  });
  return panel;
}
```

- [ ] **Step 4: Run / confirm pass**

Run: `npx vitest run tests/webview/propertiesPanel.test.ts` — Expected: PASS (both).

- [ ] **Step 5: Wire selection + toggle + post in the renderer**

In `codedWorkflowRenderer.ts`: track `selectedId` (already in view-state); on a card click set selection and mount `renderPropertiesPanel(selectedCard, { editing, onEdit })` into a `.cw-props-dock`; `onEdit` calls the webview→host `postMessage({ type: 'editValue', ...intent })`. Add an edit-mode toggle button that flips `editing` in the view-state and re-renders. Add `.cw-props`, `.cw-props-dock`, `.cw-props-row` styles to `codedWorkflow.css` (docked right, theme vars, no new colors).

- [ ] **Step 6: Build + run full suite**

Run: `npm run typecheck && npx vitest run && npm run build:prod`
Expected: all GREEN; build emits both wasm.

- [ ] **Step 7: Commit**

```bash
git add webview/ tests/webview/propertiesPanel.test.ts
git commit -m "feat(edit): properties panel (read-only inspector + value editing) wired to editValue"
```

---

## Task 8: End-to-end verification (manual) + package

**Files:** none (verification)

- [ ] **Step 1: Repackage + reinstall**

Run: `npx --no-install vsce package && code --install-extension uipath-artifact-designer-1.0.2.vsix --force`. Reload the VS Code window.

- [ ] **Step 2: Manual E2E on `docs/legibility/InvoiceProcessing/Workflows/IngestInvoices.cs`**

Verify, recording results:
- Open canvas → toggle Edit mode → select the first **Log** card → the panel shows `Message = "Starting daily invoice ingestion run"`.
- Change it → the `.cs` updates to the new literal, the canvas re-renders with the new text, and **one Ctrl+Z** reverts both the file and the canvas.
- Edit the **Add Queue Item** queue name → updates.
- Type a syntactically broken value (e.g. an unterminated string) → an "Edit rejected" notice, file unchanged.
- A tier-3 chip's panel field is **disabled/raw-only**; an expression arg shows the "raw text" note.

- [ ] **Step 3: Commit a short verification note**

```bash
git commit --allow-empty -m "test(edit): L0 manual E2E pass (value edit + undo + parse-gate reject)"
```

---

## Self-review checklist (run before handing off)

- **Spec coverage:** L0 value-edit (Tasks 1,3,6,7), surgical patch (Task 3), per-value spans (Task 1), parse-gate (Task 4,6), messages/validator/parity (Task 5), read-only default + toggle (Task 7), undo native (Task 6), honesty boundary — chips/expressions raw/disabled (Tasks 1,7), golden tests mirroring tier-2 harness (Task 3). L1/L2 intentionally out of this plan.
- **Type consistency:** `EditValueIntent.argIndex`/`newText`, `CwArgSummary.valueSpan`/`editableKind`, `TextPatch.{start,end,newText}`, `resolveEdit`/`editValue`/`introducesNewError`/`findNodeById`/`applyPatches`/`renderPropertiesPanel` used identically across tasks.
- **No placeholders:** every code step shows real code; every run step shows the command + expected result.

## Follow-on plans (not in this plan)

- **L1 (M5.1):** argument add/remove/change + method/overload switch — widens `EditIntent`, adds `editArg.ts` + the editable arg schema on the catalog.
- **L2 (M5.2):** statement add (palette + `emitStatement` + `placeStatement`) / delete / reorder + raw-code escape hatch.
