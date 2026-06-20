# Canvas Structural-Editing (L1 + L2 / M5.1 + M5.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the coded-workflow canvas from value-editing (L0) to **structural** editing — add/remove/change a call's **arguments** and switch a catalog method (L1, M5.1), and **add / delete / reorder statements** within a slot from a searchable palette, including a raw-code escape hatch (L2, M5.2) — every change a minimal, parse-gated `WorkspaceEdit` at a known source span.

**Architecture:** Unchanged from L0 and the design spec (`docs/superpowers/specs/2026-06-14-canvas-code-editing-design.md`, decision A — surgical patch). The webview never writes; it emits a typed edit intent. A pure `resolveEdit(source, model, intent)` dispatcher (in `src/model/codedWorkflow/edit/`) computes minimal `TextPatch`es from **model spans only** — the pure edit modules never parse. Two new model offsets make structural patches computable: an `argListSpan`/per-arg `argSpan` on the call (L1) and body/statement char-offset spans on slots and statements (L2). New pure modules `editArg.ts`, `emitStatement.ts`, `placeStatement.ts` produce source, golden-tested byte-exact like the tier-2 rules and L0. The host clones the existing `computeValueEdit` helper per new intent, runs the parse-gate + type-preservation backstop, and applies a range `WorkspaceEdit` priming the `lastWrittenText` echo-guard. Read-only stays the default; the L0 edit-mode toggle gates every new affordance.

**Tech Stack:** TypeScript, web-tree-sitter (C# grammar), vitest (+ jsdom for webview), esbuild, plain-DOM webview (`el`/`clearChildren` helpers, **no innerHTML**). Pure model layer enforced host-API-free by `tests/architecture.test.ts` + `tsconfig.webview.json`.

**Reference reading before starting (read in this order):**
- `docs/superpowers/specs/2026-06-14-canvas-code-editing-design.md` — the approved design (L1 = §2/§4/§6/§7; L2 = §2/§4/§5/§6/§8; risks §12).
- `docs/superpowers/plans/2026-06-14-canvas-value-editing-L0.md` — the L0 plan this one continues; same TDD rhythm and file conventions.
- `src/model/codedWorkflow/edit/` — the SHIPPED L0 engine you extend: `editTypes.ts` (`EditIntent` union, `TextPatch`, `EditResult`), `resolveEdit.ts` (dispatcher), `editValue.ts`, `applyPatches.ts`, `findNode.ts` (`findNodeById`), `parseGate.ts` (`introducesNewError`), `quoting.ts` (`requoteString`).
- `src/model/codedWorkflow/cwTypes.ts` — the IR (`CwActivityCard`, `CwArgSummary`, `OffsetSpan`, `CwSlot`, `CwEntryPoint`, `CwHelperMethod`, `CwStatement`, `SourceSpan`).
- `src/model/codedWorkflow/buildModel.ts` — where spans are populated (`toSpan`, `makeCard`, `slotFrom`, `classifyMethodBody`); you add an `offsetSpan` helper and thread it.
- `src/model/codedWorkflow/classify/tier1Catalog.ts` (`CatalogEntry`, `CatalogArgSpec`, `ServiceFamily`, `TIER1_CATALOG`, `BASE_FAMILY_ID`), `classify/argExtract.ts` (`extractArgs`, `argumentNodes`), `classify/tier1Match.ts` (`Tier1Match`).
- `src/artifacts/codedWorkflowEdit.ts` (`computeValueEdit`, `ComputedEdit`) — the host helper you clone per new intent.
- `src/artifactEditorProvider.ts` — the `case 'editValue'` handler (~line 362) + the `lastWrittenText` echo-guard.
- `src/util/messages.ts` (`WebviewToHost` union, `EditValueMessage`, `WebviewViewState`), `src/util/validateMessage.ts` (`validateWebviewMessage`, `isViewState`, `DANGEROUS_KEYS`, `MAX_*` caps), `tests/util/messageContractParity.test.ts` (`PARITY_FIXTURES` — the parity gate).
- `webview/renderers/codedWorkflow/propertiesPanel.ts` (`renderPropertiesPanel`, `PropertiesEdit`), `webview/renderers/codedWorkflow/containers.ts` (`renderStatements`, `RenderCtx`, `buildContainer`), `webview/renderers/codedWorkflow/stepCard.ts` (`buildActivityCard`), `webview/renderers/codedWorkflowRenderer.ts` (dock, `renderDock`, `buildEditToggle`, `buildStatementColumn`, `host.post`), `webview/util.ts` (`el`/`clearChildren`/`svgEl`).
- `tests/model/codedWorkflow/edit/editValue.test.ts` + `tests/model/codedWorkflow/edit/helpers.ts` parent (`configureCSharpParserFromNodeModules`) — the golden harness to mirror.

---

## Key decision (spec §7, risk #2): emit-template location

**`emit` field on `CatalogEntry`, plus a derived webview-safe `editCatalog.ts`.**

- The emit template lives **on `CatalogEntry`** in `tier1Catalog.ts` as a new optional `emit?: CatalogEmit` (pure data — a receiver/method/arg-schema record, no functions). Co-locating it with the render `args` keeps a single source of truth keyed by method name; a parallel list keyed by method would drift the moment someone adds a catalog member.
- The **palette** is a webview surface, but the webview bundle only sees `cwTypes.ts` from the model (see `tsconfig.webview.json` `include`). So a new pure module `src/model/codedWorkflow/edit/editCatalog.ts` flattens every `CatalogEntry` that has an `emit` into a `PALETTE_ITEMS: PaletteItem[]` array (label, catalogId, arg schema) **plus** the two fixed "common steps" (Assign, Add item) and the raw-code escape. `editCatalog.ts` is pure data + a flatten function (web-tree-sitter-free), so it is added to `tsconfig.webview.json`'s `include` and imported by the palette UI directly. The host emission engine (`emitStatement.ts`) reads the **same** `PALETTE_ITEMS`, so palette and emission never disagree.

This satisfies "kept as pure data … the palette is generated from it" without a second source of truth and without the webview reaching into `tier1Catalog.ts` (which it cannot — that file is not in the webview include, and adding the whole catalog would over-expose the matcher internals; `editCatalog.ts` exposes exactly the addable surface).

---

## File Structure

**Create (L1):**
- `src/model/codedWorkflow/edit/editArg.ts` — pure resolver for `editArg` intents: splice inside an `argument_list` (change / add-trailing-optional / remove an argument; switch the called method name). Computes patches from the model's `argListSpan` + per-arg `argSpan`; never parses.
- `tests/model/codedWorkflow/edit/editArg.test.ts` — byte-exact goldens (change / add / remove / method-switch / rejection cases).
- `tests/model/codedWorkflow/argListSpan.test.ts` — asserts `buildModel` captures `argListSpan` on a card and `argSpan` on each arg.

**Modify (L1):**
- `src/model/codedWorkflow/cwTypes.ts` — add `argListSpan?: OffsetSpan` to `CwActivityCard`; add `argSpan?: OffsetSpan` to `CwArgSummary`.
- `src/model/codedWorkflow/buildModel.ts` — add an `offsetSpan(node)` helper; populate `argListSpan` in `makeCard`; thread the invocation through arg extraction so each row gets `argSpan`.
- `src/model/codedWorkflow/classify/argExtract.ts` — capture the whole `argument` node's offsets as `argSpan` on each returned `CwArgSummary` (alongside the existing `valueSpan`).
- `src/model/codedWorkflow/classify/tier1Catalog.ts` — add `CatalogEmit` + `CatalogEmitArg` types and an `emit?` field; populate `emit` for `Log`, `system.AddQueueItem`, `system.GetAsset` (seed set).
- `src/model/codedWorkflow/edit/editTypes.ts` — widen `EditIntent` with `EditArgIntent`.
- `src/model/codedWorkflow/edit/resolveEdit.ts` — dispatch `editArg`.
- `src/util/messages.ts` — add the `editArg` member to `WebviewToHost`; add `EditArgMessage` alias.
- `src/util/validateMessage.ts` — `editArg` validator branch.
- `src/artifacts/codedWorkflowEdit.ts` — add `computeArgEdit` (clone of `computeValueEdit`).
- `src/artifactEditorProvider.ts` — `case 'editArg'` handler.
- `webview/renderers/codedWorkflow/propertiesPanel.ts` — add/remove-optional-arg affordances + a method/overload `<select>`; widen `PropertiesPanelOptions` with `onArgEdit`.
- `webview/renderers/codedWorkflowRenderer.ts` — wire `onArgEdit` → `post({ type: 'editArg', … })`.
- `webview/styles/codedWorkflow.css` — styles for the new panel controls.
- `tests/util/messageContractParity.test.ts` — `editArg` parity fixture.
- `tests/util/validateMessage.test.ts` — `editArg` accept/reject cases.
- `tests/webview/propertiesPanel.test.ts` — add/remove/method-switch emission.

**Create (L2):**
- `src/model/codedWorkflow/edit/editCatalog.ts` — pure palette data: `PaletteItem`, `PALETTE_ITEMS` (flattened catalog emit entries + Assign + Add item + raw escape), `findPaletteItem(id)`.
- `src/model/codedWorkflow/edit/emitStatement.ts` — the **C# emission engine**: `emitStatement(item, argValues, resultBinding?, rawText?) → string` — one statement's source from a palette item + user values (inverse of tier-1; never a method body; `rawText` carries the free-text escape).
- `src/model/codedWorkflow/edit/placeStatement.ts` — span arithmetic: `insertionAt(slot, indexInSlot)` (offset + inferred indentation/EOL), `deletionRange(model, id)` (the statement's full-line char range), `moveWithin(slot, fromIndex, toIndex)` (delete + reinsert offsets).
- `tests/model/codedWorkflow/edit/emitStatement.test.ts` — emission goldens (catalog activity / Assign / Add item / raw passthrough).
- `tests/model/codedWorkflow/edit/editCatalog.test.ts` — palette flatten + lookup.
- `tests/model/codedWorkflow/edit/addStatement.test.ts`, `deleteStatement.test.ts`, `moveStatement.test.ts` — end-to-end source goldens through `resolveEdit`.
- `tests/model/codedWorkflow/slotOffsets.test.ts` — asserts `buildModel` captures `bodySpan` on slots/methods and `offsets` on statements.
- `tests/webview/insertionPalette.test.ts` — palette render + intent emission (jsdom).

**Modify (L2):**
- `src/model/codedWorkflow/cwTypes.ts` — add `offsets?: OffsetSpan` to every statement (via `CwNodeBase`); add `bodySpan?: OffsetSpan` + `indentText?: string` to `CwSlot`, `CwEntryPoint`, `CwHelperMethod`.
- `src/model/codedWorkflow/buildModel.ts` — populate `offsets` on every node (`makeCard`/`makeChip`/`makeContainer`/pseudo/`slotFrom`/method bodies) and `bodySpan`/`indentText` on slots + method bodies.
- `src/model/codedWorkflow/edit/editTypes.ts` — widen `EditIntent` with `AddStatementIntent`, `DeleteStatementIntent`, `MoveStatementIntent`; add `SlotRef`.
- `src/model/codedWorkflow/edit/resolveEdit.ts` — dispatch the three new kinds.
- `src/model/codedWorkflow/edit/findNode.ts` — add `findSlot(model, ref)` (locate a `CwSlot` / method body by a `SlotRef`).
- `src/util/messages.ts` — add `addStatement`, `deleteStatement`, `moveStatement` members + aliases.
- `src/util/validateMessage.ts` — three validator branches + an `isSlotRef` helper.
- `src/artifacts/codedWorkflowEdit.ts` — `computeAddStatement`, `computeDeleteStatement`, `computeMoveStatement`.
- `src/artifactEditorProvider.ts` — three new `case` handlers.
- `webview/renderers/codedWorkflow/containers.ts` — `renderStatements` emits `+` insertion points + per-card delete/reorder handles when editing; `RenderCtx` widened with `editing` + `onInsert`/`onDelete`/`onMove` + slot identity.
- `webview/renderers/codedWorkflow/insertionPalette.ts` (**create**) — the searchable palette popover built from `PALETTE_ITEMS`.
- `webview/renderers/codedWorkflowRenderer.ts` — thread the L2 callbacks into `renderCtx()`; post the three intents.
- `webview/styles/codedWorkflow.css` — insertion point / palette / handle styles.
- `tsconfig.webview.json` — add the webview-bundled `edit/` modules AND their full host-API-free transitive closure to `include` (so `architecture.test.ts`, which scans only literally-listed files, actually covers every bundled file): `editCatalog.ts`, `editTypes.ts`, `emitStatement.ts`, `quoting.ts`, and `classify/tier1Catalog.ts` (pulled in by `editCatalog`/`emitStatement`).
- `tests/util/messageContractParity.test.ts` — three parity fixtures.
- `tests/util/validateMessage.test.ts` — three accept/reject sets.
- `tests/architecture.test.ts` — no change needed; it reads the tsconfig include automatically (the new entries must stay host-API-free, which is asserted).

---

# Milestone L1 (M5.1): Argument add / remove / change + method switch

The model already carries a per-VALUE `valueSpan` (L0). To splice arguments we need two more spans: the `argument_list` interior boundaries (`argListSpan`) and each `argument` node's full range (`argSpan`). Then `editArg` computes minimal patches; the bidirectional catalog's `emit` arg-schema tells the panel which optional args can be added and how to render a new one.

## Task L1.1: Capture the argument-list span + per-arg span in the model

**Files:**
- Modify: `src/model/codedWorkflow/cwTypes.ts`
- Modify: `src/model/codedWorkflow/buildModel.ts`
- Modify: `src/model/codedWorkflow/classify/argExtract.ts`
- Test: `tests/model/codedWorkflow/argListSpan.test.ts`

- [ ] **Step 1: Extend the IR types**

In `cwTypes.ts`, add `argListSpan` to `CwActivityCard` and `argSpan` to `CwArgSummary`:

```ts
export interface CwArgSummary {
  label: string;
  value: string;
  kind: 'literal' | 'interpolated' | 'identifier' | 'target' | 'expression';
  valueSpan?: OffsetSpan;
  valueRaw?: string;
  /**
   * Char offsets of the WHOLE `argument` node (name + value), so a remove can
   * delete the argument and a change can replace it. Absent for synthesized
   * rows (e.g. object-prop summaries) and indexer keys with no argument node.
   */
  argSpan?: OffsetSpan;
  editableKind: 'string' | 'number' | 'bool' | 'enum' | 'identifier' | 'raw' | 'none';
}
```

```ts
export interface CwActivityCard extends CwNodeBase {
  type: 'activity';
  tier: 1;
  service: string;
  serviceDisplayName: string;
  method: string;
  catalogId?: string;
  title: string;
  args: CwArgSummary[];
  resultBinding?: string;
  icon: string;
  /**
   * Char offsets of the INTERIOR of the call's `argument_list` — the range
   * between `(` and `)` exclusive (so an empty `()` has start === end). An
   * arg add splices at `argListSpan.end`; a method switch needs the call's
   * function name span (resolved from the source by the host, not stored).
   * Absent for indexer matches (no argument_list) and synthesized cards.
   */
  argListSpan?: OffsetSpan;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/model/codedWorkflow/argListSpan.test.ts
import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

async function cardOf(source: string): Promise<{ card: CwActivityCard; source: string }> {
  const tree = (await getCSharpParser()).parse(source);
  try {
    const model = buildModel(tree, source, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    return { card: model.classes[0].entryPoints[0].body[0] as CwActivityCard, source };
  } finally {
    tree.delete();
  }
}

it('captures the argument-list interior span', async () => {
  const src = 'class W : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }';
  const { card, source } = await cardOf(src);
  expect(card.argListSpan).toBeDefined();
  // The interior is exactly the source between the parens.
  expect(source.slice(card.argListSpan!.start, card.argListSpan!.end)).toBe('"hi"');
});

it('captures each argument node span', async () => {
  const src =
    'class W : CodedWorkflow { [Workflow] public void Execute() { system.AddQueueItem("Q", item); } }';
  const { card, source } = await cardOf(src);
  expect(card.args[0].argSpan).toBeDefined();
  expect(source.slice(card.args[0].argSpan!.start, card.args[0].argSpan!.end)).toBe('"Q"');
});

it('reports an empty interior span for a no-arg call', async () => {
  const src =
    'class W : CodedWorkflow { [Workflow] public void Execute() { var x = system.GetTransactionItem(); } }';
  const { card } = await cardOf(src);
  expect(card.argListSpan).toBeDefined();
  expect(card.argListSpan!.start).toBe(card.argListSpan!.end);
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run tests/model/codedWorkflow/argListSpan.test.ts`
Expected: FAIL — `argListSpan`/`argSpan` undefined.

- [ ] **Step 4: Add an `offsetSpan` helper + populate `argListSpan` in buildModel**

In `buildModel.ts`, next to `toSpan`, add:

```ts
import type { OffsetSpan } from './cwTypes';

/** Char-offset span (for surgical edits) from tree-sitter indices. */
function offsetSpan(node: Node): OffsetSpan {
  return { start: node.startIndex, end: node.endIndex };
}
```

In `makeCard`, capture the `argument_list` interior from `match.invocation`. The interior is between the `(` and `)` tokens of the `arguments` field:

```ts
/** Interior char span of an invocation's argument_list (between the parens). */
function argListInterior(invocation: Node | undefined): OffsetSpan | undefined {
  if (invocation === undefined) return undefined;
  const argList = invocation.childForFieldName('arguments');
  if (argList === null) return undefined;
  // argument_list children are `( arg , arg )`; the interior is between the
  // first '(' and the last ')'.
  let open: Node | null = null;
  let close: Node | null = null;
  for (let i = 0; i < argList.childCount; i += 1) {
    const c = argList.child(i);
    if (c === null) continue;
    if (c.type === '(' && open === null) open = c;
    if (c.type === ')') close = c;
  }
  if (open === null || close === null) return undefined;
  return { start: open.endIndex, end: close.startIndex };
}
```

Then in `makeCard`'s returned object add (only for non-indexer cards — indexer matches have no `invocation`):

```ts
    ...(match.method !== '[indexer]'
      ? { argListSpan: argListInterior(match.invocation) }
      : {}),
```

Place this alongside the existing `catalogId`/`resultBinding` spread fields.

- [ ] **Step 5: Populate `argSpan` in argExtract**

`extractArgs` already walks `argumentNodes(invocation)`. Thread the owning `argument` node into `finalize` so each row records it. Change `renderSpec` and the generic branch to pass the `argument` node, and extend `finalize`:

```ts
// finalize gains the owning argument node (optional — indexer keys omit it).
function finalize(
  label: string,
  rendered: Rendered,
  source: string,
  argNode?: Node
): CwArgSummary {
  return {
    label,
    value: rendered.value,
    kind: rendered.kind,
    editableKind: rendered.editableKind,
    ...(argNode !== undefined ? { argSpan: { start: argNode.startIndex, end: argNode.endIndex } } : {}),
    ...(rendered.node !== undefined
      ? {
          valueSpan: { start: rendered.node.startIndex, end: rendered.node.endIndex },
          valueRaw: source.slice(rendered.node.startIndex, rendered.node.endIndex)
        }
      : {})
  };
}
```

In the generic branch of `extractArgs`, pass the arg node:

```ts
  return args.slice(0, GENERIC_ARG_COUNT).map((arg, i) => {
    const value = argValueNode(arg);
    const rendered: Rendered =
      value !== null
        ? renderValue(value, source, ARG_VALUE_MAX_LEN)
        : { value: '', kind: 'expression', editableKind: 'none' };
    return finalize(`arg${i + 1}`, rendered, source, arg);
  });
```

In `renderSpec`, the matched `argument` node is `findSpecArg(spec, args)` — pass it through:

```ts
function renderSpec(spec: CatalogArgSpec, args: Node[], source: string): CwArgSummary | null {
  const arg = findSpecArg(spec, args);
  if (arg === null) return null;
  const value = argValueNode(arg);
  if (value === null) return null;
  const maxLen = spec.maxLen ?? ARG_VALUE_MAX_LEN;
  let rendered: Rendered | null;
  switch (spec.render) {
    case 'target': rendered = renderTarget(value, source, maxLen); break;
    case 'objectProps': rendered = renderObjectProps(value, spec.props ?? [], source, maxLen); break;
    default: rendered = renderValue(value, source, maxLen); break;
  }
  if (rendered === null) return null;
  return finalize(spec.label, rendered, source, arg);
}
```

`extractIndexerKey` stays unchanged (its `finalize('Key', …, source)` call omits `argNode`, so indexer keys carry no `argSpan` — correct, they are not argument-list members).

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run tests/model/codedWorkflow/argListSpan.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Regenerate golden model snapshots**

The new optional fields change `goldenModels` snapshots. Run: `npx vitest run -u tests/model/codedWorkflow/goldenModels.test.ts`, then eyeball the diff (only `argListSpan`/`argSpan` added). Run the full suite: `npx vitest run` — expected GREEN.

- [ ] **Step 8: Commit**

```bash
git add src/model/codedWorkflow/cwTypes.ts src/model/codedWorkflow/buildModel.ts src/model/codedWorkflow/classify/argExtract.ts tests/
git commit -m "feat(edit): capture argument-list + per-arg spans on activity cards (L1 prep)"
```

---

## Task L1.2: Bidirectional catalog — `emit` field + arg schema

Add the inverse of the render catalog: how to re-emit a recognized call, and a per-arg schema (label, kind, required?) the panel uses to offer add/remove of optional args.

**Files:**
- Modify: `src/model/codedWorkflow/classify/tier1Catalog.ts`
- Test: `tests/model/codedWorkflow/edit/editCatalog.test.ts` (created here; expanded in L2.1)

- [ ] **Step 1: Add the emit types + seed data**

In `tier1Catalog.ts`, add above `CatalogEntry`:

```ts
/** One emittable/addable argument of a cataloged call (the INVERSE of CatalogArgSpec). */
export interface CatalogEmitArg {
  /** Label shown in the panel / palette form. */
  label: string;
  /**
   * Typed-input affordance for the value field. Mirrors CwArgSummary.editableKind
   * minus 'none' (every emit arg is fillable); 'string' content is auto-quoted
   * by the emitter, the rest are raw source text the parse-gate validates.
   */
  kind: 'string' | 'number' | 'bool' | 'identifier' | 'raw';
  /** false ⇒ optional (offer an add/remove toggle); omitted ⇒ required. */
  required?: boolean;
  /** Default source text for a freshly added optional arg (already in source form). */
  placeholder?: string;
}

/** How to re-emit (and add args to) a cataloged call. Pure data — no functions. */
export interface CatalogEmit {
  /**
   * The call as a template. `{recv}` ⇒ the service receiver (e.g. `system`) or
   * '' for a base call; `{args}` ⇒ the comma-joined emitted arguments. Result
   * binding (`var x = `) is prepended by the emitter, not the template.
   */
  template: string;
  /** Ordered argument schema; positional. Required args come first by convention. */
  args: CatalogEmitArg[];
  /** True when the call returns a value worth binding (palette offers a result name). */
  returnsValue?: boolean;
}
```

Add `emit?: CatalogEmit;` to `CatalogEntry`. Then populate the seed set (keep small + obviously-correct, per the catalog's seed convention) — `Log`, `system.AddQueueItem`, `system.GetAsset`:

```ts
// inside BASE_FAMILY_ID entries, on the Log entry:
{
  method: 'Log',
  title: 'Log',
  args: [{ arg: 0, label: 'Message', render: 'text' }],
  emit: {
    template: 'Log({args})',
    args: [{ label: 'Message', kind: 'string', placeholder: '""' }]
  }
},
```

```ts
// inside the 'system' family, on AddQueueItem:
{
  method: 'AddQueueItem',
  title: 'Add Queue Item',
  args: [{ arg: 0, label: 'Queue', render: 'text' }],
  emit: {
    template: '{recv}.AddQueueItem({args})',
    args: [
      { label: 'Queue', kind: 'string', placeholder: '""' },
      { label: 'Item', kind: 'identifier', required: false, placeholder: 'item' }
    ]
  }
},
```

```ts
// inside the 'system' family, on GetAsset:
{
  method: 'GetAsset',
  title: 'Get Asset',
  args: [{ arg: 0, label: 'Name', render: 'text' }],
  emit: {
    template: '{recv}.GetAsset({args})',
    args: [{ label: 'Name', kind: 'string', placeholder: '""' }],
    returnsValue: true
  }
},
```

- [ ] **Step 2: Write a guard test (every `emit` is internally consistent)**

```ts
// tests/model/codedWorkflow/edit/editCatalog.test.ts
import { it, expect } from 'vitest';
import { TIER1_CATALOG, BASE_FAMILY_ID } from '../../../../src/model/codedWorkflow/classify/tier1Catalog';

it('every emit template references {args} and has at least one arg schema', () => {
  for (const family of TIER1_CATALOG) {
    for (const entry of family.entries) {
      if (entry.emit === undefined) continue;
      expect(entry.emit.template, `${family.id}.${entry.method}`).toContain('{args}');
      expect(entry.emit.args.length, `${family.id}.${entry.method}`).toBeGreaterThan(0);
      // A non-base template must reference the receiver placeholder.
      if (family.id !== BASE_FAMILY_ID) {
        expect(entry.emit.template, `${family.id}.${entry.method}`).toContain('{recv}');
      }
    }
  }
});
```

- [ ] **Step 3: Run it to confirm it passes (data-only — no impl needed)**

Run: `npx vitest run tests/model/codedWorkflow/edit/editCatalog.test.ts`
Expected: PASS. (If a template is malformed, fix the data, not the test.)

- [ ] **Step 4: Typecheck (the new types reach the webview via L2's tsconfig change; here verify host build)**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/codedWorkflow/classify/tier1Catalog.ts tests/model/codedWorkflow/edit/editCatalog.test.ts
git commit -m "feat(edit): add bidirectional emit + arg schema to the tier-1 catalog (seed set)"
```

---

## Task L1.3: `editArg` intent type + dispatcher arm

**Files:**
- Modify: `src/model/codedWorkflow/edit/editTypes.ts`
- Modify: `src/model/codedWorkflow/edit/resolveEdit.ts`
- Test: (covered by L1.4)

- [ ] **Step 1: Widen the intent union**

In `editTypes.ts`, add `EditArgIntent` and widen `EditIntent`:

```ts
/**
 * L1 intent: structural change to a call's arguments, or its method name.
 * Exactly one operation per intent:
 *  - op 'change'  → replace arg #argIndex's WHOLE argument with `newText`.
 *  - op 'add'     → splice `newText` as a new trailing argument.
 *  - op 'remove'  → delete arg #argIndex (and its separating comma).
 *  - op 'method'  → replace the called method name with `newMethod`
 *                   (overload/method switch; args untouched).
 */
export interface EditArgIntent {
  kind: 'editArg';
  id: string;
  op: 'change' | 'add' | 'remove' | 'method';
  /** Required for 'change' / 'remove'; ignored otherwise. */
  argIndex?: number;
  /** Source text of the new/changed argument (for 'change' / 'add'). */
  newText?: string;
  /** New method name (for 'method'). */
  newMethod?: string;
}

export type EditIntent = EditValueIntent | EditArgIntent; // L2 widens further
```

- [ ] **Step 2: Dispatch it**

In `resolveEdit.ts`:

```ts
import { editArg } from './editArg';
// ...
  switch (intent.kind) {
    case 'editValue': return editValue(source, model, intent);
    case 'editArg': return editArg(source, model, intent);
    default: return { ok: false, error: `unsupported edit: ${(intent as { kind: string }).kind}` };
  }
```

- [ ] **Step 3: Typecheck (editArg not yet created — expect a missing-module error)**

Run: `npm run typecheck`
Expected: FAIL — cannot find module `./editArg`. (Resolved in L1.4.)

- [ ] **Step 4: Commit (WIP — deliberately compiles only after L1.4; keep these two changes together by committing in L1.4 instead)**

Skip a standalone commit; fold these edits into L1.4's commit so the tree never has a broken import.

---

## Task L1.4: `editArg` resolver (pure, golden-tested)

The resolver computes patches from model spans only (it never parses). Method names: the model does not store the function-name span, so for `op: 'method'` the resolver locates the method-name occurrence inside the card's `span` deterministically from `source` + the known `method`. To keep the module pure-but-not-parsing, the host passes the card's method-name offsets via a tiny pre-resolution lookup is **not** needed — instead we replace the **first** occurrence of the exact `"<method>("` within the statement's char range, which is unambiguous because the method name immediately precedes its argument list.

**Files:**
- Create: `src/model/codedWorkflow/edit/editArg.ts`
- Test: `tests/model/codedWorkflow/edit/editArg.test.ts`

- [ ] **Step 1: Write the failing golden tests**

```ts
// tests/model/codedWorkflow/edit/editArg.test.ts
import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';
import type { CwActivityCard, CodedWorkflowModel } from '../../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => configureCSharpParserFromNodeModules());

const wrap = (s: string) => `class W : CodedWorkflow { [Workflow] public void Execute() { ${s} } }`;

async function build(src: string): Promise<{ model: CodedWorkflowModel; card: CwActivityCard }> {
  const tree = (await getCSharpParser()).parse(src);
  try {
    const model = buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' });
    return { model, card: model.classes[0].entryPoints[0].body[0] as CwActivityCard };
  } finally {
    tree.delete();
  }
}

it('changes an argument in place, touching only its span', async () => {
  const src = wrap('system.AddQueueItem("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 1, newText: 'other' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.AddQueueItem("Q", other);'));
});

it('adds a trailing argument to a single-arg call', async () => {
  const src = wrap('system.AddQueueItem("Q");');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: 'item' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.AddQueueItem("Q", item);'));
});

it('adds the first argument to an empty call', async () => {
  const src = wrap('Log();');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'add', newText: '"hi"' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('Log("hi");'));
});

it('removes the last argument (and its leading comma)', async () => {
  const src = wrap('system.AddQueueItem("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'remove', argIndex: 1 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('system.AddQueueItem("Q");'));
});

it('removes the first of two arguments (and its following comma)', async () => {
  const src = wrap('system.AddQueueItem("Q", item);');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'remove', argIndex: 0 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  // Removing the first arg drops it and the following comma+space.
  expect(applyPatches(src, res.patches)).toBe(wrap('system.AddQueueItem(item);'));
});

it('switches the method name, leaving args intact', async () => {
  const src = wrap('var a = system.GetAsset("k");');
  const { model } = await build(src);
  const card = model.classes[0].entryPoints[0].body[0] as CwActivityCard;
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'method', newMethod: 'GetCredential' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe(wrap('var a = system.GetCredential("k");'));
});

it('rejects change on a row with no argSpan', async () => {
  const src = wrap('Log("hi");');
  const { model, card } = await build(src);
  const res = resolveEdit(src, model, { kind: 'editArg', id: card.id, op: 'change', argIndex: 99, newText: 'x' });
  expect(res.ok).toBe(false);
});

it('rejects an editArg on a non-activity node', async () => {
  const src = wrap('var t = DateTime.Now;'); // tier-2 pseudo-step
  const { model } = await build(src);
  const node = model.classes[0].entryPoints[0].body[0];
  const res = resolveEdit(src, model, { kind: 'editArg', id: node.id, op: 'remove', argIndex: 0 });
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/model/codedWorkflow/edit/editArg.test.ts`
Expected: FAIL — module `./editArg` not found.

- [ ] **Step 3: Implement `editArg`**

```ts
// src/model/codedWorkflow/edit/editArg.ts
// PURITY: imports only model types + sibling pure modules — never the parser.
import type { CodedWorkflowModel, CwActivityCard, OffsetSpan } from '../cwTypes';
import type { EditArgIntent, EditResult, TextPatch } from './editTypes';
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
```

Note: `removalRange`'s middle-arg test (`argIndex: 0` of a two-arg call) eats the FOLLOWING comma, yielding `system.AddQueueItem(item);` — matching the golden. The last-arg case (`argIndex: 1`) eats the PRECEDING comma, yielding `system.AddQueueItem("Q");`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/model/codedWorkflow/edit/editArg.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit (fold in the L1.3 dispatcher + intent changes)**

```bash
git add src/model/codedWorkflow/edit/editTypes.ts src/model/codedWorkflow/edit/resolveEdit.ts src/model/codedWorkflow/edit/editArg.ts tests/model/codedWorkflow/edit/editArg.test.ts
git commit -m "feat(edit): pure editArg resolver — change/add/remove arg + method switch (golden-tested)"
```

---

## Task L1.5: `editArg` message contract + validator

**Files:**
- Modify: `src/util/messages.ts`
- Modify: `src/util/validateMessage.ts`
- Modify: `tests/util/messageContractParity.test.ts`
- Modify: `tests/util/validateMessage.test.ts`

- [ ] **Step 1: Add the message + alias**

In `messages.ts`, append to the `WebviewToHost` union (in the `--- coded workflow canvas ---` block, after `editValue`):

```ts
  | {
      type: 'editArg';
      /** The activity card whose arguments are edited. */
      id: string;
      op: 'change' | 'add' | 'remove' | 'method';
      /** Required for change/remove. */
      argIndex?: number;
      /** Source text of the new/changed argument (change/add). */
      newText?: string;
      /** New method name (method switch). */
      newMethod?: string;
    };
```

And add the alias next to `EditValueMessage`:

```ts
export type EditArgMessage = Extract<WebviewToHost, { type: 'editArg' }>;
```

- [ ] **Step 2: Write the failing validator tests**

```ts
// add to tests/util/validateMessage.test.ts
import { validateWebviewMessage } from '../../src/util/validateMessage';

it('accepts a well-formed editArg change', () => {
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'change', argIndex: 1, newText: 'x' })).not.toBeNull();
});
it('accepts an editArg method switch', () => {
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: 'GetCredential' })).not.toBeNull();
});
it('rejects an editArg with an unknown op', () => {
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'nuke' })).toBeNull();
});
it('rejects an editArg whose newMethod is prototype-polluting', () => {
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: '__proto__' })).toBeNull();
});
it('rejects an editArg whose newMethod is not a bare identifier (code injection)', () => {
  // The validator — not just the parse-gate — must reject a non-identifier name.
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: 'X(); Evil(' })).toBeNull();
  expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: '1Bad' })).toBeNull();
});
```

- [ ] **Step 3: Run / confirm fail (validator + parity both fail)**

Run: `npx vitest run tests/util/`
Expected: FAIL — `editArg` unhandled (validator returns null) and the parity test reports it missing from `PARITY_FIXTURES`.

- [ ] **Step 4: Implement the validator branch**

In `validateMessage.ts`, add in the `--- coded workflow canvas ---` block:

Add a module-level identifier matcher near the other helpers (a method name is written into source verbatim BEFORE any semantic check, and the parse-gate is currently the sole downstream guard — a syntactic identifier check is cheap belt-and-suspenders that stops e.g. `X(); Evil(` at the validator):

```ts
/** A bare C# identifier — the only shape a switched method name may take. */
const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;
```

```ts
    case 'editArg':
      return isString(raw.id, MAX_ID) &&
        (raw.op === 'change' || raw.op === 'add' || raw.op === 'remove' || raw.op === 'method') &&
        (raw.argIndex === undefined || (typeof raw.argIndex === 'number' && Number.isInteger(raw.argIndex))) &&
        (raw.newText === undefined || isString(raw.newText, MAX_TEXT)) &&
        // A method name is written into source as an identifier — require BOTH a
        // safe key (no prototype pollution) AND a bare-identifier shape (so a
        // payload like `X(); Evil(` is rejected here, not just at the parse-gate).
        (raw.newMethod === undefined ||
          (isSafeKey(raw.newMethod) && IDENTIFIER_RE.test(raw.newMethod)))
        ? {
            type: 'editArg',
            id: raw.id,
            op: raw.op,
            ...(raw.argIndex !== undefined ? { argIndex: raw.argIndex } : {}),
            ...(raw.newText !== undefined ? { newText: raw.newText } : {}),
            ...(raw.newMethod !== undefined ? { newMethod: raw.newMethod } : {})
          }
        : null;
```

- [ ] **Step 5: Add the parity fixture**

In `tests/util/messageContractParity.test.ts`, append to `PARITY_FIXTURES` (after the `editValue` entry):

```ts
  { type: 'editArg', minValid: { id: 'W#Execute/0', op: 'change', argIndex: 0, newText: 'x' } },
```

- [ ] **Step 6: Run the suite / confirm pass**

Run: `npx vitest run tests/util/`
Expected: PASS, including `messageContractParity`.

- [ ] **Step 7: Commit**

```bash
git add src/util/messages.ts src/util/validateMessage.ts tests/util/
git commit -m "feat(edit): editArg message contract + validator + parity fixture"
```

---

## Task L1.6: Host handler — apply `editArg` via WorkspaceEdit

**Files:**
- Modify: `src/artifacts/codedWorkflowEdit.ts`
- Modify: `src/artifactEditorProvider.ts`
- Test: pure path already covered (L1.4); host wiring verified by bundle smoke + L1.8 E2E.

- [ ] **Step 1: Add `computeArgEdit` (clone of `computeValueEdit`)**

In `codedWorkflowEdit.ts`:

```ts
import type { EditArgMessage } from '../util/messages';

/** Build the model fresh, resolve the editArg, run the parse-gate. */
export async function computeArgEdit(source: string, message: EditArgMessage): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  let model;
  try {
    model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
  const res = resolveEdit(source, model, {
    kind: 'editArg',
    id: message.id,
    op: message.op,
    ...(message.argIndex !== undefined ? { argIndex: message.argIndex } : {}),
    ...(message.newText !== undefined ? { newText: message.newText } : {}),
    ...(message.newMethod !== undefined ? { newMethod: message.newMethod } : {})
  });
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  // Structural backstop: the patched source must still build a model with the
  // SAME node id present (an add/remove must not destroy the entry point or
  // re-shape ids around it). Cheaper + sufficient: assert the node still
  // resolves and is still an activity.
  const treeAfter = parser.parse(after);
  let afterModel;
  try {
    afterModel = buildModel(treeAfter, after, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    treeAfter.delete();
  }
  const stillThere = findNodeById(afterModel, message.id);
  if (stillThere === null || stillThere.type !== 'activity') {
    return { ok: false, error: 'edit reshaped the workflow structure unexpectedly' };
  }
  return { ok: true, patches: res.patches, after };
}
```

- [ ] **Step 2: Add the provider case (clone of `editValue`)**

In `artifactEditorProvider.ts`, import `computeArgEdit` alongside `computeValueEdit`, and add a case after `editValue`:

```ts
      case 'editArg': {
        const source = document.getText();
        const computed = await computeArgEdit(source, message);
        if (!computed.ok) {
          void vscode.window.showWarningMessage(`Edit rejected: ${computed.error}`);
          break;
        }
        this.lastWrittenText.set(this.documentKey(document.uri), computed.after);
        const edit = new vscode.WorkspaceEdit();
        for (const p of computed.patches) {
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(p.start), document.positionAt(p.end)),
            p.newText
          );
        }
        await vscode.workspace.applyEdit(edit);
        break;
      }
```

- [ ] **Step 3: Typecheck + bundle-smoke**

Run: `npm run typecheck && npm run smoke && npm run build:prod`
Expected: typecheck clean, `[smoke] PASS`, build complete.

- [ ] **Step 4: Commit**

```bash
git add src/artifacts/codedWorkflowEdit.ts src/artifactEditorProvider.ts
git commit -m "feat(edit): host applies editArg via WorkspaceEdit behind the parse-gate"
```

---

## Task L1.7: Properties panel — add/remove optional args + method switch

The panel already renders a row per existing arg (L0). Add: a **remove (×)** button on each removable arg row; an **add-argument** control offering the catalog's optional args (those with `required: false`); a **method `<select>`** when the card's family catalogs more than one method (overload/method switch). All gated by `editing`.

**Files:**
- Modify: `webview/renderers/codedWorkflow/propertiesPanel.ts`
- Modify: `webview/renderers/codedWorkflowRenderer.ts`
- Modify: `webview/styles/codedWorkflow.css`
- Test: `tests/webview/propertiesPanel.test.ts`

- [ ] **Step 1: Write the failing panel tests**

```ts
// add to tests/webview/propertiesPanel.test.ts
import type { PropertiesArgEdit } from '../../webview/renderers/codedWorkflow/propertiesPanel';

it('emits an editArg remove when a row × is clicked', () => {
  const onArgEdit = vi.fn();
  const c = card(); // Log card with one Message arg
  c.args[0].argSpan = { start: 0, end: 4 };
  const root = document.createElement('div');
  root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit }));
  const remove = root.querySelector('.cw-arg-remove') as HTMLButtonElement;
  remove.click();
  expect(onArgEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', op: 'remove', argIndex: 0 });
});

it('does not show remove buttons in read-only mode', () => {
  const c = card();
  c.args[0].argSpan = { start: 0, end: 4 };
  const root = document.createElement('div');
  root.appendChild(renderPropertiesPanel(c, { editing: false, onEdit: () => {}, onArgEdit: () => {} }));
  expect(root.querySelector('.cw-arg-remove')).toBeNull();
});
```

- [ ] **Step 2: Run / confirm fail**

Run: `npx vitest run tests/webview/propertiesPanel.test.ts`
Expected: FAIL — `onArgEdit`/`PropertiesArgEdit` unknown; no `.cw-arg-remove`.

- [ ] **Step 3: Widen the panel API + render the controls**

In `propertiesPanel.ts`:

```ts
/** Structural edit intent emitted by the panel (mirrors `editArg`). */
export interface PropertiesArgEdit {
  id: string;
  op: 'change' | 'add' | 'remove' | 'method';
  argIndex?: number;
  newText?: string;
  newMethod?: string;
}

export interface PropertiesPanelOptions {
  editing: boolean;
  onEdit: (edit: PropertiesEdit) => void;
  /** Structural argument / method edits. */
  onArgEdit: (edit: PropertiesArgEdit) => void;
}
```

In the per-arg `forEach`, append a remove button when editing and the arg has a backing `argSpan`:

```ts
    if (opts.editing && arg.argSpan !== undefined) {
      const remove = el('button', { class: 'cw-arg-remove', text: '×', title: `Remove ${arg.label}` });
      remove.type = 'button';
      remove.addEventListener('click', () => opts.onArgEdit({ id: card.id, op: 'remove', argIndex }));
      row.append(remove);
    }
```

(Method `<select>` + add-argument control follow the same DOM-helper pattern; they are wired in this step but only the remove path is unit-asserted above. Build the `<select>` from the card's `service`+`method` against `PALETTE_ITEMS`/the catalog family — its `change` handler calls `onArgEdit({ id, op: 'method', newMethod })`. The add control reads optional emit args, builds an `el('select')` of unfilled optional labels, and on pick calls `onArgEdit({ id, op: 'add', newText: placeholder })`.)

- [ ] **Step 4: Wire `onArgEdit` in the renderer**

In `codedWorkflowRenderer.ts`'s `renderDock`, extend the `renderPropertiesPanel(card, { … })` options:

```ts
      renderPropertiesPanel(card, {
        editing: this.editing,
        onEdit: (edit) => {
          this.host?.post({ type: 'editValue', id: edit.id, argIndex: edit.argIndex, newText: edit.newText });
        },
        onArgEdit: (edit) => {
          this.host?.post({
            type: 'editArg',
            id: edit.id,
            op: edit.op,
            ...(edit.argIndex !== undefined ? { argIndex: edit.argIndex } : {}),
            ...(edit.newText !== undefined ? { newText: edit.newText } : {}),
            ...(edit.newMethod !== undefined ? { newMethod: edit.newMethod } : {})
          });
        }
      })
```

- [ ] **Step 5: Run / confirm pass**

Run: `npx vitest run tests/webview/propertiesPanel.test.ts`
Expected: PASS.

- [ ] **Step 6: Add styles (no innerHTML; theme vars only)**

In `codedWorkflow.css`, add `.cw-arg-remove`, `.cw-arg-add`, `.cw-method-select` rules (small, theme-variable colors only — mirror the existing `.cw-props-*` rules; no new literal colors).

- [ ] **Step 7: Build + full suite**

Run: `npm run typecheck && npx vitest run && npm run build:prod`
Expected: all GREEN.

- [ ] **Step 8: Commit**

```bash
git add webview/ tests/webview/propertiesPanel.test.ts
git commit -m "feat(edit): properties panel arg add/remove + method switch wired to editArg"
```

---

## Task L1.8: L1 milestone close — verification + E2E

**Files:** none (verification)

- [ ] **Step 1: Green gate**

Run: `npm run typecheck && npx vitest run && npm run smoke && npm run build:prod`
Expected: typecheck clean (both tsconfigs), all tests PASS, `[smoke] PASS`, build complete.

- [ ] **Step 2: Repackage + reinstall**

Run: `npx --no-install vsce package && code --install-extension uipath-artifact-designer-1.1.0.vsix --force`. Reload the VS Code window.

- [ ] **Step 3: Manual E2E on `docs/legibility/InvoiceProcessing/Workflows/IngestInvoices.cs`**

Verify, recording results:
- Toggle Edit mode → select an **Add Queue Item** card → remove its second argument → the `.cs` drops the arg, canvas re-renders, one Ctrl+Z reverts.
- Add the optional argument back from the add-argument control → it reappears with the placeholder, ready to edit.
- Select a **Get Asset** card → switch the method to **Get Credential** via the `<select>` → the call name changes, args intact.
- A change that would break syntax (e.g. an unbalanced new arg) → "Edit rejected" notice; file unchanged.

- [ ] **Step 4: Commit a verification note**

```bash
git commit --allow-empty -m "test(edit): L1 manual E2E pass (arg add/remove/change + method switch + undo)"
```

---

# Milestone L2 (M5.2): Statement add / delete / reorder + raw escape

L2 adds: insertion offsets on slots/method bodies + per-statement char spans (so placement is computable from the model), a pure emission engine (`emitStatement`), placement arithmetic (`placeStatement`), the palette (catalog activities + Assign + Add item + raw escape), and the three intents. Read-only stays default; affordances appear only when `editing`.

## Task L2.1: Model offsets for placement + the palette data module

**Files:**
- Modify: `src/model/codedWorkflow/cwTypes.ts`
- Modify: `src/model/codedWorkflow/buildModel.ts`
- Modify: `src/model/codedWorkflow/chips.ts` (carry `offsets` onto merged chips — Fence F)
- Create: `src/model/codedWorkflow/edit/editCatalog.ts`
- Modify: `tsconfig.webview.json`
- Test: `tests/model/codedWorkflow/slotOffsets.test.ts`, extend `tests/model/codedWorkflow/edit/editCatalog.test.ts`

- [ ] **Step 1: Extend the IR with placement offsets**

In `cwTypes.ts`, add `offsets` to `CwNodeBase` (so every statement carries it) and `bodySpan`/`indentText` to slots + methods:

```ts
interface CwNodeBase {
  id: string;
  span: SourceSpan;
  /** Char offsets of the whole statement node (for delete/move ranges). */
  offsets?: OffsetSpan;
}
```

```ts
export interface CwSlot {
  role: CwSlotRole;
  label: string;
  children: CwStatement[];
  span: SourceSpan;
  /**
   * Char offsets of the slot BODY interior — the range inside the `{ }` block
   * (or the single block-less statement). An insert at the top of an empty
   * slot targets `bodySpan.start`; an append targets `bodySpan.end`.
   */
  bodySpan?: OffsetSpan;
  /** Leading whitespace of statements in this slot (inferred indentation). */
  indentText?: string;
}
```

Add the same two optional fields to `CwEntryPoint` and `CwHelperMethod` (their `body` is a slot-less statement list, so they own the body interior + indent directly):

```ts
export interface CwEntryPoint {
  name: string;
  attribute: 'Workflow' | 'TestCase';
  span: SourceSpan;
  signatureSummary: string;
  body: CwStatement[];
  tierCounts: CwTierCounts;
  bodySpan?: OffsetSpan;
  indentText?: string;
  /**
   * The exact id-prefix `buildModel` assigned this body's statements
   * (`<class>#<methodSegment>/`, e.g. `W#Execute/` or, for an overload,
   * `W#Run@2/`). A SlotRef's `methodId` is matched against THIS, so insertion
   * is unambiguous even for overloaded methods and empty bodies. (Reconstructing
   * `<class>#<name>/` from `name` would mis-target the 2nd+ overload.)
   */
  bodyId?: string;
}
// (CwHelperMethod: add bodySpan?, indentText?, bodyId? identically)
```

- [ ] **Step 2: Write the failing model test**

```ts
// tests/model/codedWorkflow/slotOffsets.test.ts
import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(src: string) {
  const tree = (await getCSharpParser()).parse(src);
  try { return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}

it('captures the entry-point body interior + per-statement offsets', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '    Log("b");',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const ep = model.classes[0].entryPoints[0];
  expect(ep.bodySpan).toBeDefined();
  // The body id-prefix is exactly what assignIds used (no overload here).
  expect(ep.bodyId).toBe('W#Execute/');
  // The two statements sit inside the body interior.
  expect(ep.body[0].offsets).toBeDefined();
  expect(src.slice(ep.body[0].offsets!.start, ep.body[0].offsets!.end)).toBe('Log("a");');
  // The statement id uses the same prefix.
  expect(ep.body[0].id.startsWith(ep.bodyId!)).toBe(true);
  // Inferred indentation is the 4-space leading whitespace.
  expect(ep.indentText).toBe('    ');
});

it('captures a slot body interior for an if/then', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    if (x) {',
    '      Log("t");',
    '    }',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const container = model.classes[0].entryPoints[0].body[0];
  if (container.type !== 'container') throw new Error('expected container');
  const then = container.slots[0];
  expect(then.bodySpan).toBeDefined();
  expect(then.indentText).toBe('      ');
});

it('carries offsets onto a MERGED raw chip (Fence F: chips delete/move as a unit)', async () => {
  // Two adjacent unrecognized bare calls → two raw chips that merge into one.
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Foo();',
    '    Bar();',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const body = model.classes[0].entryPoints[0].body;
  expect(body).toHaveLength(1);            // the two chips merged
  expect(body[0].type).toBe('raw');
  // The merged chip's offsets span Foo();…Bar(); so a delete removes both lines.
  expect(body[0].offsets).toBeDefined();
  expect(src.slice(body[0].offsets!.start, body[0].offsets!.end)).toBe('Foo();\n    Bar();');
});
```

- [ ] **Step 3: Run / confirm fail**

Run: `npx vitest run tests/model/codedWorkflow/slotOffsets.test.ts`
Expected: FAIL — `offsets`/`bodySpan`/`indentText` undefined.

- [ ] **Step 4: Populate offsets in buildModel**

While editing `buildModel.ts`, fix a stale doc comment you will pass: `BuildModelInput.tier2Rules`'s JSDoc says "Production callers leave this unset and get the shipped `TIER2_RULES` (currently empty)." `TIER2_RULES` is NOT empty — 9 rules ship today (console-write, assign-literal, collection-add, assign-from-call, string-op, assign-new-object, linq-single-chain, file-op, datetime-arith). Change "(currently empty)" to "(the 9 shipped tier-2 rules)" so the comment doesn't mislead. (This also explains why L1.4's `var t = DateTime.Now;` test expects a tier-2 pseudo-step, not a chip.)

Reuse the `offsetSpan` helper (added in L1.1). Set `offsets` on every node builder:
- `makeCard`: `offsets: offsetSpan(/* the statement node */)` — but `makeCard` receives a `SourceSpan`, not the node. Change the leaf path to pass offsets: in `classifyLeaf`, capture `offsetSpan(stmt)` and attach after `makeCard`/`applyTier2`/`makeChip`. Simplest: add a post-step in `classifyLeaf`:

```ts
function classifyLeaf(stmt: Node, ctx: ClassifyContext): CwStatement {
  trackHandle(ctx.handles, stmt);
  const node = leafNode(stmt, ctx);
  node.offsets = offsetSpan(stmt);
  return node;
}

function leafNode(stmt: Node, ctx: ClassifyContext): CwStatement {
  const match = matchTier1(stmt, ctx.handles);
  if (match !== null) return makeCard(match, toSpan(stmt), ctx);
  const pseudo = applyTier2(stmt, ctx.source, ctx.tier2Rules);
  if (pseudo !== null) return pseudo;
  return makeChip(stmt, ctx);
}
```

- `makeContainer`: set `offsets: offsetSpan(stmt)` on the returned container (the `stmt` is in scope).
- **Merged chips MUST get `offsets`** (Fence F: "tier-3 chips move/delete as a unit"). A merged chip with no offsets would be undeletable/unmovable — a visible chip the user can't act on. `mergeAdjacentChips` runs as a post-pass in `classifyStatements`, AFTER `classifyStatement` → `classifyLeaf` has already set `offsets` on each single chip, so the run's inputs are populated. Set the merged chip's offsets from the run's first/last in `chips.ts`'s `mergeRun`:

```ts
// src/model/codedWorkflow/chips.ts — mergeRun: carry offsets from the run.
function mergeRun(run: CwRawChip[], source: string): CwRawChip {
  const merged = chipFromSpan(
    {
      startLine: run[0].span.startLine,
      startCol: run[0].span.startCol,
      endLine: run[run.length - 1].span.endLine,
      endCol: run[run.length - 1].span.endCol
    },
    source,
    run.reduce((sum, chip) => sum + chip.statementCount, 0)
  );
  // Fence F: the merged chip spans run[0].start … run[last].end in char offsets,
  // so it deletes/moves as a unit. Inputs always have offsets (set in classifyLeaf
  // before this merge post-pass); fall back to span-only (undefined) only if not.
  if (run[0].offsets !== undefined && run[run.length - 1].offsets !== undefined) {
    merged.offsets = { start: run[0].offsets.start, end: run[run.length - 1].offsets.end };
  }
  return merged;
}
```

  Single chips keep their `classifyLeaf` offsets through `capChip` (which returns the chip unchanged, or `{ ...chip }` — both preserve `offsets`). The truncation fold chip is built by `chipFromSpan` directly in `truncateStatements` and is deliberately left WITHOUT `offsets` (the folded region is read-only — see L2.4: a fold chip's delete is rejected, honestly).

For body interiors + indentation, add a helper and call it where bodies are built:

```ts
/** Interior offsets of a block ({ … }) and the leading indent of its 1st stmt. */
function bodyInterior(block: Node | null, source: string): { bodySpan?: OffsetSpan; indentText?: string } {
  if (block === null || block.type !== 'block') return {};
  let open: Node | null = null;
  let close: Node | null = null;
  for (let i = 0; i < block.childCount; i += 1) {
    const c = block.child(i);
    if (c === null) continue;
    if (c.type === '{' && open === null) open = c;
    if (c.type === '}') close = c;
  }
  if (open === null || close === null) return {};
  const firstStmt = block.namedChildren.find((c) => c.type !== 'comment') ?? null;
  let indentText = '    ';
  if (firstStmt !== null) {
    const lineStart = source.lastIndexOf('\n', firstStmt.startIndex - 1) + 1;
    indentText = source.slice(lineStart, firstStmt.startIndex).replace(/[^ \t]/g, '');
  }
  return { bodySpan: { start: open.endIndex, end: close.startIndex }, indentText };
}
```

In `slotFrom`, when `body` is a block, merge in `bodyInterior(body, ctx.source)`:

```ts
function slotFrom(role, label, body, fallbackSpanNode, ctx): CwSlot {
  if (body === null) {
    return { role, label: capHeader(label), children: [], span: toSpan(fallbackSpanNode) };
  }
  const children = body.type === 'block'
    ? classifyStatements(blockStatements(body), ctx)
    : classifyStatements([body], ctx);
  return {
    role,
    label: capHeader(label),
    children,
    span: toSpan(body),
    ...bodyInterior(body.type === 'block' ? body : null, ctx.source)
  };
}
```

In `classifyMethodBody`, return the interior too — but it returns `CwStatement[]`. Lift the body-interior capture to the call sites in `buildModel` where `entryPoints.push`/`helperMethods.push` happen. Add a tiny helper that re-derives the method body block:

```ts
function methodBodyInterior(method: Node, source: string): { bodySpan?: OffsetSpan; indentText?: string } {
  const body = method.childForFieldName('body');
  return bodyInterior(body, source);
}
```

Then in `buildModel`'s method loop:

```ts
      const interior = methodBodyInterior(method, source);
      // `methodSegment` and the prefix are already computed above for assignIds;
      // capture the SAME prefix as bodyId so SlotRef matching is exact.
      const bodyId = `${className}#${methodSegment}/`;
      if (attribute !== null) {
        entryPoints.push({ name, attribute, span: toSpan(method), signatureSummary: signatureSummary(method), body, tierCounts, bodyId, ...interior });
      } else {
        helperMethods.push({ name, span: toSpan(method), body, tierCounts, bodyId, ...interior });
      }
```

(`methodSegment` is the existing local from the `assignIds(body, \`${className}#${methodSegment}/\`)` line — reuse it; do not recompute.)

Note: `assignIds` runs over `body` and does not touch `offsets` (it only sets `id`), so offsets survive. Truncation folds (`truncateStatements`) replace tail nodes with a synthetic chip carrying no `offsets` — acceptable (the folded region is read-only-ish; insertion targets the kept region).

- [ ] **Step 5: Run / confirm pass + regenerate goldens**

Run: `npx vitest run tests/model/codedWorkflow/slotOffsets.test.ts` → PASS.
Run: `npx vitest run -u tests/model/codedWorkflow/goldenModels.test.ts`, eyeball the diff (only `offsets`/`bodySpan`/`indentText` added), then `npx vitest run` → GREEN.

- [ ] **Step 6: Create the palette data module**

```ts
// src/model/codedWorkflow/edit/editCatalog.ts
// PURITY: pure data + a flatten function. web-tree-sitter-FREE so it is safe
// for the webview bundle (added to tsconfig.webview.json include).
import { TIER1_CATALOG, BASE_FAMILY_ID, type CatalogEmitArg } from '../classify/tier1Catalog';

/** One addable palette entry. */
export interface PaletteItem {
  /** Stable palette id: `catalog:<service>.<method>` | `step:assign` | `step:add-item` | `raw`. */
  id: string;
  /** Display label in the palette. */
  label: string;
  /** Search keywords (lower-cased). */
  keywords: string[];
  /** Argument schema to fill before emit; empty for the raw escape. */
  args: CatalogEmitArg[];
  /** True when a result binding name should be offered. */
  returnsValue?: boolean;
  /** Kind, so the emitter dispatches: a catalog call, a fixed step, or raw text. */
  kind: 'catalog' | 'assign' | 'add-item' | 'raw';
  /** For 'catalog': the service receiver (`system`) or '' for base; the emit template. */
  recv?: string;
  template?: string;
}

const ASSIGN_ITEM: PaletteItem = {
  id: 'step:assign',
  label: 'Assign',
  keywords: ['assign', 'set', 'variable', 'let'],
  args: [
    { label: 'Variable', kind: 'identifier', placeholder: 'value' },
    { label: 'Value', kind: 'raw', placeholder: '0' }
  ],
  kind: 'assign'
};

const ADD_ITEM: PaletteItem = {
  id: 'step:add-item',
  label: 'Add item',
  keywords: ['add', 'item', 'list', 'collection', 'append'],
  args: [
    { label: 'Collection', kind: 'identifier', placeholder: 'items' },
    { label: 'Item', kind: 'raw', placeholder: 'item' }
  ],
  kind: 'add-item'
};

const RAW_ITEM: PaletteItem = {
  id: 'raw',
  label: 'Raw code…',
  keywords: ['raw', 'code', 'custom', 'escape', 'csharp', 'c#'],
  args: [],
  kind: 'raw'
};

/** All palette items: cataloged emit entries first, then the fixed steps + raw. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  ...TIER1_CATALOG.flatMap((family) =>
    family.entries
      .filter((e) => e.emit !== undefined)
      .map((e): PaletteItem => ({
        id: `catalog:${family.id}.${e.method}`,
        label: e.title,
        keywords: [e.title.toLowerCase(), e.method.toLowerCase(), family.displayName.toLowerCase()],
        args: e.emit!.args,
        returnsValue: e.emit!.returnsValue,
        kind: 'catalog',
        recv: family.id === BASE_FAMILY_ID ? '' : family.id,
        template: e.emit!.template
      }))
  ),
  ASSIGN_ITEM,
  ADD_ITEM,
  RAW_ITEM
];

/** Look up a palette item by id; null when unknown. */
export function findPaletteItem(id: string): PaletteItem | null {
  return PALETTE_ITEMS.find((p) => p.id === id) ?? null;
}
```

- [ ] **Step 7: Extend the catalog test + add it to the webview tsconfig**

Append to `tests/model/codedWorkflow/edit/editCatalog.test.ts`:

```ts
import { PALETTE_ITEMS, findPaletteItem } from '../../../../src/model/codedWorkflow/edit/editCatalog';

it('flattens cataloged emit entries plus the three fixed items', () => {
  expect(findPaletteItem('catalog:_base.Log')).not.toBeNull();
  expect(findPaletteItem('step:assign')).not.toBeNull();
  expect(findPaletteItem('step:add-item')).not.toBeNull();
  expect(findPaletteItem('raw')).not.toBeNull();
  expect(findPaletteItem('nope')).toBeNull();
  // Base-family items carry an empty receiver.
  expect(findPaletteItem('catalog:_base.Log')!.recv).toBe('');
  expect(findPaletteItem('catalog:system.AddQueueItem')!.recv).toBe('system');
});
```

In `tsconfig.webview.json` `include`, add the webview-included edit modules **and their full host-API-free transitive closure**. `architecture.test.ts` only scans files LITERALLY listed in `include`, so a bundled-but-unlisted transitive dep is bundled-but-unguarded — every dep that rides into the webview bundle must be listed so the purity guard actually covers it. Closure audit:

- `editCatalog.ts` → imports `tier1Catalog.ts` (`TIER1_CATALOG`, `BASE_FAMILY_ID`, type `CatalogEmitArg`). `tier1Catalog.ts` is pure data (header: `PURITY RULE: no vscode/fs/path/node:*`).
- `editTypes.ts` → no value imports (pure types).
- (`emitStatement.ts` + `quoting.ts` are added in L2.7 Step 8 when the webview starts emitting; `emitStatement.ts` → `editCatalog.ts` + `quoting.ts` + type from `tier1Catalog.ts`; `quoting.ts` is pure, header `PURITY: no vscode/fs/path/node:*`.)

Add now (the L2.1 closure — palette data + intent shapes + the catalog they pull in):

```json
    "src/model/codedWorkflow/edit/editCatalog.ts",
    "src/model/codedWorkflow/edit/editTypes.ts",
    "src/model/codedWorkflow/classify/tier1Catalog.ts",
```

- [ ] **Step 8: Run / confirm pass (incl. architecture purity)**

Run: `npx vitest run tests/model/codedWorkflow/edit/editCatalog.test.ts tests/architecture.test.ts`
Expected: PASS — `editCatalog.ts`, `editTypes.ts`, and `tier1Catalog.ts` import no host APIs, so the architecture guard scans all three and stays green. (If any newly-listed file imported `vscode`/`fs`/`path`/`node:*`, this test would now FAIL — that is the point: the guard now covers the whole bundled closure, not just the entry modules.)

- [ ] **Step 9: Commit**

```bash
git add src/model/codedWorkflow/cwTypes.ts src/model/codedWorkflow/buildModel.ts src/model/codedWorkflow/chips.ts src/model/codedWorkflow/edit/editCatalog.ts tsconfig.webview.json tests/
git commit -m "feat(edit): placement offsets on slots/statements (incl. merged chips) + webview-safe palette catalog (L2 prep)"
```

---

## Task L2.2: `emitStatement` — the C# emission engine (pure, golden-tested)

`(palette item, filled arg values, optional result binding) → one statement's source`. Catalog items substitute the template; Assign emits `var x = value;`; Add item emits `coll.Add(item);`; raw passes the user text through verbatim (terminated with `;` if missing). String-kind args are auto-quoted (reusing `requoteString` semantics) so a low-code value can't decay into a bare identifier.

**Files:**
- Create: `src/model/codedWorkflow/edit/emitStatement.ts`
- Test: `tests/model/codedWorkflow/edit/emitStatement.test.ts`

- [ ] **Step 1: Write the failing emission goldens**

```ts
// tests/model/codedWorkflow/edit/emitStatement.test.ts
import { it, expect } from 'vitest';
import { emitStatement } from '../../../../src/model/codedWorkflow/edit/emitStatement';
import { findPaletteItem } from '../../../../src/model/codedWorkflow/edit/editCatalog';

it('emits a base Log call with an auto-quoted string arg', () => {
  const item = findPaletteItem('catalog:_base.Log')!;
  expect(emitStatement(item, ['hello'])).toBe('Log("hello");');
});

it('emits a system call with the receiver and a quoted string', () => {
  const item = findPaletteItem('catalog:system.GetAsset')!;
  expect(emitStatement(item, ['MyAsset'], 'asset')).toBe('var asset = system.GetAsset("MyAsset");');
});

it('emits AddQueueItem with a string + identifier', () => {
  const item = findPaletteItem('catalog:system.AddQueueItem')!;
  expect(emitStatement(item, ['Retries', 'item'])).toBe('system.AddQueueItem("Retries", item);');
});

it('emits an Assign', () => {
  const item = findPaletteItem('step:assign')!;
  expect(emitStatement(item, ['count', '0'])).toBe('var count = 0;');
});

it('emits an Add item', () => {
  const item = findPaletteItem('step:add-item')!;
  expect(emitStatement(item, ['rows', 'row'])).toBe('rows.Add(row);');
});

it('passes raw code through, adding a trailing semicolon when missing', () => {
  const item = findPaletteItem('raw')!;
  expect(emitStatement(item, [], undefined, 'DoThing(x)')).toBe('DoThing(x);');
  expect(emitStatement(item, [], undefined, 'DoThing(x);')).toBe('DoThing(x);');
});

it('does not double-quote a string value that is already a literal', () => {
  const item = findPaletteItem('catalog:_base.Log')!;
  // A user who types an explicit quoted literal keeps it (still one literal).
  expect(emitStatement(item, ['"hi"'])).toBe('Log("hi");');
});
```

- [ ] **Step 2: Run / confirm fail**

Run: `npx vitest run tests/model/codedWorkflow/edit/emitStatement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the emitter**

```ts
// src/model/codedWorkflow/edit/emitStatement.ts
// PURITY: no vscode/fs/path/node:* imports. Pure string assembly.
import type { PaletteItem } from './editCatalog';
import type { CatalogEmitArg } from '../classify/tier1Catalog';
import { requoteString } from './quoting';

/** Render one arg value to source per its schema kind (strings auto-quoted). */
function renderArg(schema: CatalogEmitArg, value: string): string {
  if (schema.kind === 'string') {
    // Already a literal? keep it. Otherwise treat the text as CONTENT + quote.
    const trimmed = value.trim();
    if (/^[@$]{0,2}"/.test(trimmed)) return trimmed;
    return requoteString(value, '""');
  }
  return value;
}

/**
 * Emit exactly ONE statement's C# source.
 *   - catalog: substitute {recv}/{args} in the template, prepend `var x = ` when
 *     a result binding is given.
 *   - assign:  `var <name> = <value>;`
 *   - add-item:`<coll>.Add(<item>);`
 *   - raw:     the user's `rawText` verbatim, `;`-terminated.
 */
export function emitStatement(
  item: PaletteItem,
  argValues: string[],
  resultBinding?: string,
  rawText?: string
): string {
  switch (item.kind) {
    case 'raw': {
      const text = (rawText ?? '').trim();
      return text.endsWith(';') || text.endsWith('}') ? text : `${text};`;
    }
    case 'assign': {
      const [name, value] = argValues;
      return `var ${name} = ${value};`;
    }
    case 'add-item': {
      const [coll, valueItem] = argValues;
      return `${coll}.Add(${valueItem});`;
    }
    case 'catalog': {
      const rendered = item.args.map((schema, i) => renderArg(schema, argValues[i] ?? '')).filter((s) => s !== '');
      const call = (item.template ?? '')
        .replace('{recv}', item.recv ?? '')
        .replace('{args}', rendered.join(', '));
      const binding = resultBinding !== undefined && resultBinding !== '' ? `var ${resultBinding} = ` : '';
      return `${binding}${call};`;
    }
  }
}
```

- [ ] **Step 4: Run / confirm pass**

Run: `npx vitest run tests/model/codedWorkflow/edit/emitStatement.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/model/codedWorkflow/edit/emitStatement.ts tests/model/codedWorkflow/edit/emitStatement.test.ts
git commit -m "feat(edit): pure emitStatement engine — catalog/assign/add-item/raw (golden-tested)"
```

---

## Task L2.3: `placeStatement` — placement + deletion + move arithmetic (pure)

**Files:**
- Create: `src/model/codedWorkflow/edit/placeStatement.ts`
- Modify: `src/model/codedWorkflow/edit/findNode.ts`
- Modify: `src/model/codedWorkflow/edit/editTypes.ts`
- Test: covered through `resolveEdit` in L2.4; a focused unit test here for the helpers.

- [ ] **Step 1: Add `SlotRef` + intents to editTypes**

```ts
/**
 * Locates a slot (or a method body) for insertion. A method body is referenced
 * with an empty `containerId` (the entry-point/helper body itself); a slot is
 * referenced by its container id + slot role + repeat index.
 */
export interface SlotRef {
  /** Container node id, or '' for the entry-point/helper top-level body. */
  containerId: string;
  /** Method body id (the `<class>#<method>/` prefix without trailing index). Used when containerId === ''. */
  methodId: string;
  /** Slot role (then/else/body/…); omitted for a method body. */
  role?: string;
  /** 0-based occurrence index for repeatable roles (elseif/catch/case). */
  roleIndex?: number;
}

/** L2 intent: insert a new statement into a slot at a position. */
export interface AddStatementIntent {
  kind: 'addStatement';
  slot: SlotRef;
  /** 0-based index within the slot's children to insert BEFORE (length ⇒ append). */
  index: number;
  /** The fully-emitted statement source (already through emitStatement). */
  source: string;
}

/** L2 intent: delete a statement by id. */
export interface DeleteStatementIntent {
  kind: 'deleteStatement';
  id: string;
}

/** L2 intent: move a statement within its slot. */
export interface MoveStatementIntent {
  kind: 'moveStatement';
  id: string;
  /** +1 (down) or -1 (up). Bounds are clamped by the resolver. */
  direction: 1 | -1;
}

export type EditIntent =
  | EditValueIntent
  | EditArgIntent
  | AddStatementIntent
  | DeleteStatementIntent
  | MoveStatementIntent;
```

- [ ] **Step 2: Add `findSlot` + a sibling list lookup to findNode**

```ts
// add to src/model/codedWorkflow/edit/findNode.ts
import type { CwSlot, CwStatement, CodedWorkflowModel } from '../cwTypes';
import type { SlotRef } from './editTypes';

/** A resolved insertion target: the children list + its body interior offsets. */
export interface SlotTarget {
  children: CwStatement[];
  bodySpan?: { start: number; end: number };
  indentText?: string;
}

/** Resolve a SlotRef to the children list + body interior, or null. */
export function findSlot(model: CodedWorkflowModel, ref: SlotRef): SlotTarget | null {
  if (ref.containerId === '') {
    // Match on the EXACT id-prefix buildModel assigned (bodyId), so overloaded
    // methods (`W#Run@2/`) and empty bodies resolve unambiguously.
    for (const cls of model.classes) {
      for (const ep of cls.entryPoints) {
        if (ep.bodyId === ref.methodId) {
          return { children: ep.body, bodySpan: ep.bodySpan, indentText: ep.indentText };
        }
      }
      for (const hm of cls.helperMethods) {
        if (hm.bodyId === ref.methodId) {
          return { children: hm.body, bodySpan: hm.bodySpan, indentText: hm.indentText };
        }
      }
    }
    return null;
  }
  const container = findNodeById(model, ref.containerId);
  if (container === null || container.type !== 'container') return null;
  const slot = matchSlot(container.slots, ref);
  return slot === null ? null : { children: slot.children, bodySpan: slot.bodySpan, indentText: slot.indentText };
}

function matchSlot(slots: CwSlot[], ref: SlotRef): CwSlot | null {
  const repeatable = new Set(['elseif', 'catch', 'case']);
  let seen = 0;
  for (const slot of slots) {
    if (slot.role !== ref.role) continue;
    if (repeatable.has(slot.role)) {
      if (seen === (ref.roleIndex ?? 0)) return slot;
      seen += 1;
    } else {
      return slot;
    }
  }
  return null;
}

/** Find the sibling list + index containing the statement id (for move/delete). */
export function findSiblings(
  model: CodedWorkflowModel,
  id: string
): { siblings: CwStatement[]; index: number } | null {
  const walk = (stmts: CwStatement[]): { siblings: CwStatement[]; index: number } | null => {
    const i = stmts.findIndex((s) => s.id === id);
    if (i >= 0) return { siblings: stmts, index: i };
    for (const s of stmts) {
      if (s.type === 'container') {
        for (const slot of s.slots) {
          const hit = walk(slot.children);
          if (hit) return hit;
        }
      }
    }
    return null;
  };
  for (const cls of model.classes) {
    for (const ep of cls.entryPoints) { const hit = walk(ep.body); if (hit) return hit; }
    for (const hm of cls.helperMethods) { const hit = walk(hm.body); if (hit) return hit; }
  }
  return null;
}
```

- [ ] **Step 3: Write the failing placement-helper test**

```ts
// tests/model/codedWorkflow/edit/placeStatement.test.ts
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
```

- [ ] **Step 4: Run / confirm fail**

Run: `npx vitest run tests/model/codedWorkflow/edit/placeStatement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `placeStatement`**

```ts
// src/model/codedWorkflow/edit/placeStatement.ts
// PURITY: pure span arithmetic over strings + model statements. No parser.
import type { CwStatement } from '../cwTypes';
import type { TextPatch } from './editTypes';
import type { SlotTarget } from './findNode';

/**
 * Patch that inserts `statementSource` into a slot at `index` (insert-before;
 * index === children.length ⇒ append). Indentation = the slot's inferred
 * `indentText`; `eol` is the document's line ending.
 */
export function insertionPatch(
  target: SlotTarget,
  index: number,
  statementSource: string,
  eol: string
): TextPatch {
  const indent = target.indentText ?? '    ';
  const kids = target.children;
  if (kids.length === 0) {
    // Empty slot: drop the statement on its own line inside the body interior.
    const at = target.bodySpan?.start ?? 0;
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}${eol}${indent}` };
  }
  if (index >= kids.length) {
    // Append after the last child with an offset.
    const last = lastWithOffsets(kids);
    const at = last?.offsets?.end ?? target.bodySpan?.end ?? 0;
    return { start: at, end: at, newText: `${eol}${indent}${statementSource}` };
  }
  // Insert before child[index].
  const ref = firstWithOffsetsFrom(kids, index);
  const at = ref?.offsets?.start ?? target.bodySpan?.start ?? 0;
  return { start: at, end: at, newText: `${statementSource}${eol}${indent}` };
}

function lastWithOffsets(kids: CwStatement[]): CwStatement | undefined {
  for (let i = kids.length - 1; i >= 0; i -= 1) if (kids[i].offsets) return kids[i];
  return undefined;
}
function firstWithOffsetsFrom(kids: CwStatement[], from: number): CwStatement | undefined {
  for (let i = from; i < kids.length; i += 1) if (kids[i].offsets) return kids[i];
  return undefined;
}

/**
 * Full-line deletion range for a statement at `offsets`: extend left to the
 * line start (eating leading indent) and right to and including the trailing
 * newline, so no blank line is left behind.
 */
export function deletionPatch(source: string, offsets: { start: number; end: number }): TextPatch {
  let start = source.lastIndexOf('\n', offsets.start - 1) + 1; // line start
  let end = offsets.end;
  // Eat trailing spaces then a single newline (\r\n or \n).
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end += 1;
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;
  // If we ate up to a newline but the line-start has prior non-deleted content
  // on the SAME physical line (inline statement), fall back to the exact range.
  if (source.slice(start, offsets.start).trim() !== '') {
    start = offsets.start;
    end = offsets.end;
  }
  return { start, end, newText: '' };
}
```

- [ ] **Step 6: Run / confirm pass**

Run: `npx vitest run tests/model/codedWorkflow/edit/placeStatement.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add src/model/codedWorkflow/edit/editTypes.ts src/model/codedWorkflow/edit/findNode.ts src/model/codedWorkflow/edit/placeStatement.ts tests/model/codedWorkflow/edit/placeStatement.test.ts
git commit -m "feat(edit): SlotRef + statement intents + placeStatement insertion/deletion arithmetic"
```

---

## Task L2.4: Wire add/delete/move into `resolveEdit` (pure, source goldens)

**Files:**
- Modify: `src/model/codedWorkflow/edit/resolveEdit.ts`
- Create: `tests/model/codedWorkflow/edit/addStatement.test.ts`, `deleteStatement.test.ts`, `moveStatement.test.ts`

- [ ] **Step 1: Write the failing end-to-end goldens**

```ts
// tests/model/codedWorkflow/edit/addStatement.test.ts
import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../../src/model/codedWorkflow/buildModel';
import { resolveEdit } from '../../../../src/model/codedWorkflow/edit/resolveEdit';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';

beforeAll(() => configureCSharpParserFromNodeModules());

const SRC = [
  'class W : CodedWorkflow {',
  '  [Workflow] public void Execute() {',
  '    Log("a");',
  '    Log("b");',
  '  }',
  '}'
].join('\n');

async function modelOf(src: string) {
  const tree = (await getCSharpParser()).parse(src);
  try { return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}

it('appends a statement at the end of the entry-point body', async () => {
  const model = await modelOf(SRC);
  const ep = model.classes[0].entryPoints[0];
  const res = resolveEdit(SRC, model, {
    kind: 'addStatement',
    slot: { containerId: '', methodId: 'W#Execute/', },
    index: ep.body.length,
    source: 'Log("c");'
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '    Log("b");',
    '    Log("c");',
    '  }',
    '}'
  ].join('\n'));
});

it('inserts a statement before the first', async () => {
  const model = await modelOf(SRC);
  const res = resolveEdit(SRC, model, {
    kind: 'addStatement',
    slot: { containerId: '', methodId: 'W#Execute/' },
    index: 0,
    source: 'Log("z");'
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("z");',
    '    Log("a");',
    '    Log("b");',
    '  }',
    '}'
  ].join('\n'));
});
```

```ts
// tests/model/codedWorkflow/edit/deleteStatement.test.ts (same imports + SRC + modelOf)
it('deletes a statement, leaving no blank line', async () => {
  const model = await modelOf(SRC);
  const second = model.classes[0].entryPoints[0].body[1];
  const res = resolveEdit(SRC, model, { kind: 'deleteStatement', id: second.id });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '  }',
    '}'
  ].join('\n'));
});

// Fence F: a MERGED tier-3 chip deletes as a unit (it carries offsets — L2.1).
it('deletes a merged raw chip as a single unit', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("keep");',
    '    Foo();',
    '    Bar();',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const body = model.classes[0].entryPoints[0].body;
  // body = [ Log card, merged(Foo();Bar()) chip ]
  const chip = body[1];
  expect(chip.type).toBe('raw');
  const res = resolveEdit(src, model, { kind: 'deleteStatement', id: chip.id });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(src, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("keep");',
    '  }',
    '}'
  ].join('\n'));
});

// Fence F (honest exemption): a TRUNCATED fold chip has no offsets (the folded
// region is read-only), so its delete is REJECTED rather than silently mangling
// source. A fold chip is defined by offsets === undefined; assert the resolver
// rejects that, without coupling the test to MAX_RENDER_STATEMENTS' exact value.
it('rejects deleting a statement with no source offsets (e.g. a truncated fold chip)', async () => {
  const model = await modelOf(SRC);
  // Simulate the fold chip: a body node whose offsets were never populated.
  const ep = model.classes[0].entryPoints[0];
  const fold = { ...ep.body[0], id: 'W#Execute/fold', offsets: undefined };
  ep.body.push(fold as typeof ep.body[number]);
  const res = resolveEdit(SRC, model, { kind: 'deleteStatement', id: 'W#Execute/fold' });
  expect(res.ok).toBe(false);
});
```

```ts
// tests/model/codedWorkflow/edit/moveStatement.test.ts (same imports + SRC + modelOf)
it('moves the second statement up above the first', async () => {
  const model = await modelOf(SRC);
  const second = model.classes[0].entryPoints[0].body[1];
  const res = resolveEdit(SRC, model, { kind: 'moveStatement', id: second.id, direction: -1 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(applyPatches(SRC, res.patches)).toBe([
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("b");',
    '    Log("a");',
    '  }',
    '}'
  ].join('\n'));
});

it('rejects moving the first statement up (out of bounds)', async () => {
  const model = await modelOf(SRC);
  const first = model.classes[0].entryPoints[0].body[0];
  const res = resolveEdit(SRC, model, { kind: 'moveStatement', id: first.id, direction: -1 });
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run / confirm fail**

Run: `npx vitest run tests/model/codedWorkflow/edit/addStatement.test.ts tests/model/codedWorkflow/edit/deleteStatement.test.ts tests/model/codedWorkflow/edit/moveStatement.test.ts`
Expected: FAIL — `resolveEdit` does not handle the new kinds.

- [ ] **Step 3: Implement the three resolver arms**

In `resolveEdit.ts`:

```ts
import { findSlot, findSiblings } from './findNode';
import { insertionPatch, deletionPatch } from './placeStatement';

// inside the switch:
    case 'addStatement': {
      const target = findSlot(model, intent.slot);
      if (target === null) return { ok: false, error: 'insertion slot not found' };
      const eol = source.includes('\r\n') ? '\r\n' : '\n';
      return { ok: true, patches: [insertionPatch(target, intent.index, intent.source, eol)] };
    }
    case 'deleteStatement': {
      const node = findNodeById(model, intent.id);
      if (node === null || node.offsets === undefined) {
        return { ok: false, error: 'statement not found or not deletable' };
      }
      return { ok: true, patches: [deletionPatch(source, node.offsets)] };
    }
    case 'moveStatement': {
      const found = findSiblings(model, intent.id);
      if (found === null) return { ok: false, error: 'statement not found' };
      const j = found.index + intent.direction;
      if (j < 0 || j >= found.siblings.length) return { ok: false, error: 'cannot move past the slot boundary' };
      const a = found.siblings[found.index];
      const b = found.siblings[j];
      if (a.offsets === undefined || b.offsets === undefined) {
        return { ok: false, error: 'a statement in the swap has no source offsets' };
      }
      // Swap the two statements' source text (their offset slices), preserving
      // everything between them. Two non-overlapping replacements.
      const aText = source.slice(a.offsets.start, a.offsets.end);
      const bText = source.slice(b.offsets.start, b.offsets.end);
      return {
        ok: true,
        patches: [
          { start: a.offsets.start, end: a.offsets.end, newText: bText },
          { start: b.offsets.start, end: b.offsets.end, newText: aText }
        ]
      };
    }
```

(`applyPatches` sorts right-to-left, so the two swap replacements are order-independent and non-overlapping.)

`findNodeById` must include `offsets` on the returned node — it already returns the model node object, which now carries `offsets`. No change needed there.

- [ ] **Step 4: Run / confirm pass**

Run: `npx vitest run tests/model/codedWorkflow/edit/addStatement.test.ts tests/model/codedWorkflow/edit/deleteStatement.test.ts tests/model/codedWorkflow/edit/moveStatement.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/model/codedWorkflow/edit/resolveEdit.ts tests/model/codedWorkflow/edit/
git commit -m "feat(edit): resolveEdit handles addStatement/deleteStatement/moveStatement (source goldens)"
```

---

## Task L2.5: Statement message contracts + validators

**Files:**
- Modify: `src/util/messages.ts`
- Modify: `src/util/validateMessage.ts`
- Modify: `tests/util/messageContractParity.test.ts`
- Modify: `tests/util/validateMessage.test.ts`

- [ ] **Step 1: Add the three messages + aliases**

Placement matters. `WebviewToHost` is a single `export type … = … ;` union terminated by a semicolon. An `interface` declared *inside* that `;`-terminated expression is a TS syntax error, AND it would shift the boundary the parity test's regex (`/export\s+type\s+WebviewToHost\s*=([\s\S]+?);\s*\n\s*\n/`) uses to extract the union's `type:` literals. So:

1. Declare `SlotRefMessage` as a **sibling** `export interface` ABOVE `export type WebviewToHost =` (next to the existing `ArgProperty` interface near the top of `messages.ts`):

```ts
/** Webview-side slot reference (mirrors edit/editTypes SlotRef). */
export interface SlotRefMessage {
  containerId: string;
  methodId: string;
  role?: string;
  roleIndex?: number;
}
```

2. Append ONLY the three `| { … }` union arms INSIDE `WebviewToHost`, after the `editValue`/`editArg` arms and BEFORE the union's closing `;` (the `editArg` arm currently ends the union with `;` — change that arm to end with a newline and move the `;` to after the new `moveStatement` arm):

```ts
  | { type: 'addStatement'; slot: SlotRefMessage; index: number; source: string }
  | { type: 'deleteStatement'; id: string }
  | { type: 'moveStatement'; id: string; direction: 1 | -1 };
```

3. Add the three aliases as siblings BELOW the union (next to `EditValueMessage`/`EditArgMessage`):

```ts
export type AddStatementMessage = Extract<WebviewToHost, { type: 'addStatement' }>;
export type DeleteStatementMessage = Extract<WebviewToHost, { type: 'deleteStatement' }>;
export type MoveStatementMessage = Extract<WebviewToHost, { type: 'moveStatement' }>;
```

(The parity test's static analysis reads `type: '<name>'` literals from the union block via regex; the three new arms keep them inside the `;`-terminated block while `SlotRefMessage` stays outside it — so the boundary regex still matches and the three new fixtures in Step 5 are required.)

- [ ] **Step 2: Write the failing validator tests**

```ts
// add to tests/util/validateMessage.test.ts
it('accepts addStatement with a method-body slot ref', () => {
  expect(validateWebviewMessage({
    type: 'addStatement',
    slot: { containerId: '', methodId: 'W#Execute/' },
    index: 0,
    source: 'Log("x");'
  })).not.toBeNull();
});
it('rejects addStatement whose slot.methodId is prototype-polluting', () => {
  expect(validateWebviewMessage({
    type: 'addStatement', slot: { containerId: '', methodId: '__proto__' }, index: 0, source: 'x;'
  })).toBeNull();
});
it('accepts deleteStatement', () => {
  expect(validateWebviewMessage({ type: 'deleteStatement', id: 'W#Execute/1' })).not.toBeNull();
});
it('accepts a moveStatement with direction -1', () => {
  expect(validateWebviewMessage({ type: 'moveStatement', id: 'W#Execute/1', direction: -1 })).not.toBeNull();
});
it('rejects a moveStatement with a bad direction', () => {
  expect(validateWebviewMessage({ type: 'moveStatement', id: 'W#Execute/1', direction: 2 })).toBeNull();
});
```

- [ ] **Step 3: Run / confirm fail (validators + parity)**

Run: `npx vitest run tests/util/`
Expected: FAIL — three messages unhandled + parity reports them missing.

- [ ] **Step 4: Implement the validators**

In `validateMessage.ts`, add an `isSlotRef` helper near `isViewState`. `methodId`/`containerId` are not written as object keys, but validate them through `isSafeKey` anyway so the validator stays the single gate (defense in depth — a `__proto__` ref is rejected here, not silently no-matched in `findSlot`). An empty `containerId` denotes the method body and is always allowed:

```ts
function isSlotRef(
  v: unknown
): v is { containerId: string; methodId: string; role?: string; roleIndex?: number } {
  return (
    isRecord(v) &&
    // '' (method body) is allowed; any non-empty container id must be a safe key.
    (v.containerId === '' || isSafeKey(v.containerId)) &&
    isSafeKey(v.methodId) &&
    // role is matched against a fixed slot-role set on the host; bound it.
    (v.role === undefined || isString(v.role, MAX_ID)) &&
    (v.roleIndex === undefined || (typeof v.roleIndex === 'number' && Number.isInteger(v.roleIndex)))
  );
}
```

(`isSafeKey` already bounds length to `MAX_ID` and applies the `DANGEROUS_KEYS` denylist, so the `__proto__` `methodId` test returns `null`.)

Then the three cases:

```ts
    case 'addStatement':
      return isSlotRef(raw.slot) &&
        typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0 &&
        isString(raw.source, MAX_TEXT)
        ? { type: 'addStatement', slot: raw.slot, index: raw.index, source: raw.source }
        : null;
    case 'deleteStatement':
      return isString(raw.id, MAX_ID) ? { type: 'deleteStatement', id: raw.id } : null;
    case 'moveStatement':
      return isString(raw.id, MAX_ID) && (raw.direction === 1 || raw.direction === -1)
        ? { type: 'moveStatement', id: raw.id, direction: raw.direction }
        : null;
```

- [ ] **Step 5: Add the parity fixtures**

In `messageContractParity.test.ts`, append:

```ts
  { type: 'addStatement', minValid: { slot: { containerId: '', methodId: 'W#Execute/' }, index: 0, source: 'x;' } },
  { type: 'deleteStatement', minValid: { id: 'W#Execute/1' } },
  { type: 'moveStatement', minValid: { id: 'W#Execute/1', direction: 1 } },
```

- [ ] **Step 6: Run / confirm pass**

Run: `npx vitest run tests/util/`
Expected: PASS, including parity (the `__proto__` `addStatement` test expects `null`, which `isSlotRef`'s `isSafeKey` check delivers).

- [ ] **Step 7: Commit**

```bash
git add src/util/messages.ts src/util/validateMessage.ts tests/util/
git commit -m "feat(edit): statement message contracts (add/delete/move) + validators + parity"
```

---

## Task L2.6: Host handlers for the three statement intents

**Files:**
- Modify: `src/artifacts/codedWorkflowEdit.ts`
- Modify: `src/artifactEditorProvider.ts`

- [ ] **Step 1: Add the three `compute*` helpers (clones of `computeArgEdit`)**

In `codedWorkflowEdit.ts`, add `computeAddStatement`, `computeDeleteStatement`, `computeMoveStatement`. Each: parse → buildModel → `resolveEdit` with the mapped intent → `applyPatches` → `introducesNewError` gate → return `{ ok, patches, after }`. The add path's `source` field is the already-emitted statement; map it straight through:

```ts
import type { AddStatementMessage, DeleteStatementMessage, MoveStatementMessage } from '../util/messages';

export async function computeAddStatement(source: string, message: AddStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, {
    kind: 'addStatement', slot: message.slot, index: message.index, source: message.source
  });
}
export async function computeDeleteStatement(source: string, message: DeleteStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, { kind: 'deleteStatement', id: message.id });
}
export async function computeMoveStatement(source: string, message: MoveStatementMessage): Promise<ComputedEdit> {
  return computeStatementEdit(source, { kind: 'moveStatement', id: message.id, direction: message.direction });
}

/** Shared: build model, resolve, parse-gate. (Same shape as computeArgEdit minus the type backstop.) */
async function computeStatementEdit(source: string, intent: EditIntent): Promise<ComputedEdit> {
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  let model;
  try {
    model = buildModel(tree, source, { fileName: 'edit.cs', fileUri: 'file:///edit.cs' });
  } finally {
    tree.delete();
  }
  const res = resolveEdit(source, model, intent);
  if (!res.ok) return { ok: false, error: res.error };
  const after = applyPatches(source, res.patches);
  if (introducesNewError(parser, source, after)) {
    return { ok: false, error: 'edit would break the C# syntax' };
  }
  return { ok: true, patches: res.patches, after };
}
```

(Import `EditIntent` from `../model/codedWorkflow/edit/editTypes`.)

- [ ] **Step 2: Add the three provider cases**

In `artifactEditorProvider.ts`, import the three helpers and add three cases mirroring `editArg` (read text → compute → reject-or-prime-echo-guard → range `WorkspaceEdit` → apply). Extract the shared 8 lines into a private `applyComputedEdit(document, computed)` to avoid four near-identical blocks:

```ts
private async applyComputedEdit(
  document: vscode.TextDocument,
  computed: { ok: true; patches: { start: number; end: number; newText: string }[]; after: string } | { ok: false; error: string }
): Promise<void> {
  if (!computed.ok) {
    void vscode.window.showWarningMessage(`Edit rejected: ${computed.error}`);
    return;
  }
  this.lastWrittenText.set(this.documentKey(document.uri), computed.after);
  const edit = new vscode.WorkspaceEdit();
  for (const p of computed.patches) {
    edit.replace(document.uri, new vscode.Range(document.positionAt(p.start), document.positionAt(p.end)), p.newText);
  }
  await vscode.workspace.applyEdit(edit);
}
```

Then:

```ts
      case 'addStatement':
        await this.applyComputedEdit(document, await computeAddStatement(document.getText(), message));
        break;
      case 'deleteStatement':
        await this.applyComputedEdit(document, await computeDeleteStatement(document.getText(), message));
        break;
      case 'moveStatement':
        await this.applyComputedEdit(document, await computeMoveStatement(document.getText(), message));
        break;
```

(Optionally refactor the existing `editValue`/`editArg` cases to call `applyComputedEdit` too — same behavior, less duplication. Keep that refactor in this commit so all four share one path.)

- [ ] **Step 3: Typecheck + bundle smoke**

Run: `npm run typecheck && npm run smoke && npm run build:prod`
Expected: clean, `[smoke] PASS`, build complete.

- [ ] **Step 4: Commit**

```bash
git add src/artifacts/codedWorkflowEdit.ts src/artifactEditorProvider.ts
git commit -m "feat(edit): host applies add/delete/move statement edits via WorkspaceEdit"
```

---

## Task L2.7: Webview — insertion points, palette, delete/reorder handles

Add `+` insertion points around statements, a searchable palette popover, and per-card delete/up/down handles — all gated by `editing`. Thread the new callbacks through `RenderCtx`.

**Files:**
- Modify: `webview/renderers/codedWorkflow/containers.ts`
- Create: `webview/renderers/codedWorkflow/insertionPalette.ts`
- Modify: `webview/renderers/codedWorkflowRenderer.ts`
- Modify: `webview/styles/codedWorkflow.css`
- Test: `tests/webview/insertionPalette.test.ts`

- [ ] **Step 1: Write the failing palette test**

```ts
// @vitest-environment jsdom
// tests/webview/insertionPalette.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderPalette } from '../../webview/renderers/codedWorkflow/insertionPalette';

describe('renderPalette', () => {
  it('lists palette items and filters by query', () => {
    const root = document.createElement('div');
    root.appendChild(renderPalette({ onPick: () => {} }));
    const items = root.querySelectorAll('.cw-pal-item');
    expect(items.length).toBeGreaterThan(0);
    const search = root.querySelector('input.cw-pal-search') as HTMLInputElement;
    search.value = 'queue';
    search.dispatchEvent(new Event('input'));
    const labels = Array.from(root.querySelectorAll('.cw-pal-item')).map((n) => n.textContent);
    expect(labels.some((l) => l?.includes('Add Queue Item'))).toBe(true);
    expect(labels.some((l) => l === 'Log')).toBe(false);
  });

  it('emits the picked item id', () => {
    const onPick = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPalette({ onPick }));
    const log = Array.from(root.querySelectorAll<HTMLElement>('.cw-pal-item')).find((n) => n.textContent === 'Log')!;
    log.click();
    expect(onPick).toHaveBeenCalledWith('catalog:_base.Log');
  });

  // Fence F (honesty): the raw escape carries NO typed arg schema, so it can only
  // ever become a free-text statement (→ a tier-3 chip), never field-edited.
  it('exposes the raw escape with an empty arg schema (no typed fields)', () => {
    const raw = findPaletteItem('raw');
    expect(raw).not.toBeNull();
    expect(raw!.kind).toBe('raw');
    expect(raw!.args).toEqual([]);
  });
});
```

(Add `import { findPaletteItem } from '../../src/model/codedWorkflow/edit/editCatalog';` to the test's imports.)

- [ ] **Step 2: Run / confirm fail**

Run: `npx vitest run tests/webview/insertionPalette.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the palette (DOM helpers only — NO innerHTML)**

```ts
// webview/renderers/codedWorkflow/insertionPalette.ts
import { el } from '../../util';
import { PALETTE_ITEMS, type PaletteItem } from '../../../src/model/codedWorkflow/edit/editCatalog';

export interface PaletteOptions {
  /** Called with the picked palette item id. */
  onPick: (id: string) => void;
}

/** A searchable list of addable statements. */
export function renderPalette(opts: PaletteOptions): HTMLElement {
  const root = el('div', { class: 'cw-pal' });
  const search = document.createElement('input');
  search.className = 'cw-pal-search';
  search.type = 'text';
  search.placeholder = 'Search activities…';
  const list = el('div', { class: 'cw-pal-list' });

  const renderList = (query: string): void => {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = PALETTE_ITEMS.filter(
      (it) => q === '' || it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))
    );
    for (const item of matches) {
      const row = el('button', { class: 'cw-pal-item', text: item.label, title: item.label });
      row.type = 'button';
      row.addEventListener('click', () => opts.onPick(item.id));
      list.append(row);
    }
  };

  search.addEventListener('input', () => renderList(search.value));
  renderList('');
  root.append(search, list);
  return root;
}

/** Re-export for callers that build an arg form from the picked item. */
export type { PaletteItem };
```

- [ ] **Step 4: Run / confirm pass**

Run: `npx vitest run tests/webview/insertionPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen `RenderCtx` + emit insertion points / handles**

In `containers.ts`, extend `RenderCtx`:

```ts
export interface RenderCtx {
  depth: number;
  isCollapsed(id: string, kind: 'chip' | 'container', collapsedByDefault: boolean): boolean;
  onToggle(id: string): void;
  /** Edit mode — when false, no insertion points / handles render. */
  editing: boolean;
  /** Open the palette to insert into a slot at an index. */
  onInsert(slot: { containerId: string; methodId: string; role?: string; roleIndex?: number }, index: number): void;
  /** Delete a statement by id. */
  onDelete(id: string): void;
  /** Move a statement by id. */
  onMove(id: string, direction: 1 | -1): void;
  /** The slot identity for the CURRENT statement list (threaded by the caller). */
  slot: { containerId: string; methodId: string; role?: string; roleIndex?: number };
}
```

`renderStatements` gains insertion points (only when `editing`) before each statement and after the last, plus per-statement handles. Keep the existing tick connectors:

```ts
export function renderStatements(stmts: CwStatement[], ctx: RenderCtx): HTMLElement {
  const seq = el('div', { class: 'cw-seq' });
  if (ctx.editing) seq.append(insertionPoint(ctx, 0));
  stmts.forEach((stmt, index) => {
    if (index > 0 && !ctx.editing) seq.append(el('div', { class: 'cw-tick' }));
    seq.append(renderStatement(stmt, ctx));
    if (ctx.editing) seq.append(insertionPoint(ctx, index + 1));
  });
  return seq;
}

function insertionPoint(ctx: RenderCtx, index: number): HTMLElement {
  const btn = el('button', { class: 'cw-insert', text: '+', title: 'Insert a step here' });
  btn.type = 'button';
  btn.addEventListener('click', () => ctx.onInsert(ctx.slot, index));
  return btn;
}
```

Per-statement handles: wrap leaf cards (only when `editing`) so delete/up/down show on the selected card. Add a small `withHandles(node, stmt, ctx)`:

```ts
function renderStatement(stmt: CwStatement, ctx: RenderCtx): HTMLElement {
  const node = renderBareStatement(stmt, ctx);
  return ctx.editing ? withHandles(node, stmt.id, ctx) : node;
}

function renderBareStatement(stmt: CwStatement, ctx: RenderCtx): HTMLElement {
  switch (stmt.type) {
    case 'activity': return buildActivityCard(stmt);
    case 'pseudo': return buildPseudoCard(stmt);
    case 'raw': return buildChip(stmt, ctx.isCollapsed(stmt.id, 'chip', true), ctx.onToggle);
    case 'container': return buildContainer(stmt, ctx);
  }
}

function withHandles(node: HTMLElement, id: string, ctx: RenderCtx): HTMLElement {
  const wrap = el('div', { class: 'cw-stmt-wrap' }, [node]);
  const handles = el('div', { class: 'cw-stmt-handles' });
  const mk = (cls: string, label: string, fn: () => void): HTMLElement => {
    const b = el('button', { class: cls, text: label, title: label });
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  handles.append(
    mk('cw-stmt-up', '↑', () => ctx.onMove(id, -1)),
    mk('cw-stmt-down', '↓', () => ctx.onMove(id, 1)),
    mk('cw-stmt-del', '🗑', () => ctx.onDelete(id))
  );
  wrap.append(handles);
  return wrap;
}
```

When recursing into slots in `buildContainer`, thread each slot's identity into the child ctx's `slot`. The shipped `buildContainer` builds `childCtx` ONCE (`const childCtx: RenderCtx = { ...ctx, depth: ctx.depth + 1 };`) and reuses it at THREE call sites — the `if`-branches loop, the `try`/`switch` sections loop, and the single-body path. Each must now compute a **per-slot** ctx whose `slot` carries the container id + slot role + (for repeatable roles) a 0-based occurrence index, matching `assignIds`' `REPEATABLE_ROLES` counter (`buildModel.ts` ~704–712). Replace the single `childCtx` with a `slotCtx(...)` factory and a per-loop `roleCounts` counter in EACH of the three loops:

```ts
// Replace `const childCtx: RenderCtx = { ...ctx, depth: ctx.depth + 1 };` with:
const REPEATABLE = new Set(['elseif', 'catch', 'case']);
const slotCtx = (role: string, roleIndex?: number): RenderCtx => ({
  ...ctx,                       // carries editing/onInsert/onDelete/onMove
  depth: ctx.depth + 1,
  slot: {
    containerId: c.id,
    methodId: ctx.slot.methodId,
    role,
    ...(roleIndex !== undefined ? { roleIndex } : {})
  }
});

// (1) if-branches loop — was: for (const slot of c.slots) { ... slotChildren(slot, childCtx) }
if (c.kind === 'if') {
  const branches = el('div', { class: 'cw-branches' });
  const roleCounts: Record<string, number> = {};
  for (const slot of c.slots) {
    const ri = REPEATABLE.has(slot.role) ? (roleCounts[slot.role] = (roleCounts[slot.role] ?? -1) + 1) : undefined;
    branches.append(
      el('div', { class: `cw-branch cw-branch--${slot.role}` }, [
        el('div', { class: 'cw-branch-label', text: slot.label }),
        slotChildren(slot, slotCtx(slot.role, ri))
      ])
    );
  }
  node.append(branches);
} else if (c.kind === 'try' || c.kind === 'switch') {
  // (2) try/switch sections loop
  const roleCounts: Record<string, number> = {};
  for (const slot of c.slots) {
    const ri = REPEATABLE.has(slot.role) ? (roleCounts[slot.role] = (roleCounts[slot.role] ?? -1) + 1) : undefined;
    node.append(
      el('div', { class: `cw-section cw-section--${slot.role}` }, [
        el('div', { class: 'cw-section-label', text: slot.label }),
        slotChildren(slot, slotCtx(slot.role, ri))
      ])
    );
  }
} else {
  // (3) single-body path — foreach/for/while/do/using
  const body = c.slots.find((slot) => slot.role === 'body') ?? c.slots[0];
  node.append(
    el('div', { class: 'cw-ct-body' }, [
      body ? slotChildren(body, slotCtx(body.role)) : emptySlotNote()
    ])
  );
}
```

`roleCounts[role] = (roleCounts[role] ?? -1) + 1` yields 0,1,2… per repeatable role (singleton roles pass `undefined`), exactly matching the `elseif0/elseif1`, `catch0/catch1`, `case0/case1` indices `assignIds` assigns — so a SlotRef built in the webview resolves to the same slot host-side. Every `slotCtx(...)` spreads `...ctx`, so `editing`/`onInsert`/`onDelete`/`onMove` propagate into nested slots; `slot` is overridden per slot. Typecheck enforces that `RenderCtx.slot` is always present (no `childCtx` without it remains).

- [ ] **Step 6: Thread the callbacks from the renderer**

In `codedWorkflowRenderer.ts`, `renderCtx()` gains the L2 fields and now takes the slot it builds for. **Both** `buildStatementColumn` call sites must pass the body's `bodyId` — there are two: `buildEntryBody` (has `entry.bodyId`) AND `buildHelperSection` (currently receives only `(className, name, stmts)`, so `helper.bodyId` is NOT in scope → a helper insert/move/delete would post `methodId: ''`, `findSlot` returns null, and the edit silently no-ops). Fix the helper path's signature too.

`renderCtx` keeps the shipped `depth: 0` (the depth is incremented in `buildContainer`'s `slotCtx`, so the top level is 0, matching the current code):

```ts
private renderCtx(slot: { containerId: string; methodId: string; role?: string; roleIndex?: number }): RenderCtx {
  return {
    depth: 0,
    isCollapsed: (id, kind, def) => effectiveCollapsed(id, kind, def, this.userToggled),
    onToggle: (id) => this.toggle(id),
    editing: this.editing,
    onInsert: (s, index) => this.openInsertPalette(s, index),
    onDelete: (id) => this.host?.post({ type: 'deleteStatement', id }),
    onMove: (id, direction) => this.host?.post({ type: 'moveStatement', id, direction }),
    slot
  };
}
```

`buildStatementColumn` takes the ctx (so the caller supplies the right `bodyId`):

```ts
private buildStatementColumn(stmts: CwStatement[], ctx: RenderCtx): HTMLElement {
  if (stmts.length === 0) {
    return el('div', { class: 'cw-empty', text: '– no statements –' });
  }
  return renderStatements(stmts, ctx);
}
```

Entry-point call site (`buildEntryBody`):

```ts
body.append(
  this.buildStatementColumn(entry.body, this.renderCtx({ containerId: '', methodId: entry.bodyId ?? '' }))
);
```

Helper call site — change `buildHelperSection`'s signature to take the `CwHelperMethod` (so `bodyId` is in scope), and update its caller in `buildClassSection`:

```ts
// buildClassSection: was `this.buildHelperSection(cls.className, helper.name, helper.body)`
sectionChildren.push(this.buildHelperSection(cls.className, helper));

// buildHelperSection now: (className: string, helper: CwHelperMethod)
private buildHelperSection(className: string, helper: CwHelperMethod): HTMLElement {
  const id = helperId(className, helper.name);
  // …header/collapse unchanged, using helper.name…
  if (!collapsed) {
    node.append(
      el('div', { class: 'cw-helper-body' }, [
        this.buildStatementColumn(helper.body, this.renderCtx({ containerId: '', methodId: helper.bodyId ?? '' }))
      ])
    );
  }
  return node;
}
```

(Import `CwHelperMethod` in the renderer if not already imported.)

**Fence F — chips never get typed inputs.** The properties panel's typed/raw fields are reached ONLY through the dock's `findActivityCard` (renderer ~line 98), which returns a node only when `type === 'activity'` (or a `using` resourceCard, itself an activity) and `null` for every `pseudo`/`raw`/`container`. So selecting a tier-3 chip mounts the dock hint, never the field editor — a chip can only be moved/deleted as a unit (the L2.7 handles) or, via the raw palette item, replaced as free text. The raw-escape regression test in Step 1 (raw item has `args: []`) guards the palette side; this activity-only `findActivityCard` filter guards the panel side. Do NOT widen `findActivityCard` to non-activity nodes.

**Emission happens in the webview** (decided): the webview imports the pure `emitStatement` (which imports only `editCatalog` + `quoting`, both host-API-free and added to the webview `include` in Step 8), builds the statement `source`, and posts the existing source-based `addStatement` intent — which the host still parse-gates. This keeps the `addStatement` contract source-based (no new `emitAndAdd` message) and the host the sole mutator.

`openInsertPalette(slot, index)` mounts `renderPalette({ onPick })` in a transient popover near the clicked insertion point (closed on pick or Escape). `onPick(id)` resolves the item via `findPaletteItem`, collects arg values from a tiny inline form (reusing the `.cw-props-input` style; the raw item has `args: []` so it shows a single free-text field), emits the source, and posts the intent:

```ts
private openInsertPalette(
  slot: { containerId: string; methodId: string; role?: string; roleIndex?: number },
  index: number
): void {
  const popover = renderPalette({
    onPick: (id) => {
      const item = findPaletteItem(id);
      if (item === null) return;
      // collectArgValues builds a small form from item.args (+ a result-name
      // field when item.returnsValue), returning the filled values, the optional
      // result binding, and (for the raw item) the free-text rawText. It resolves
      // when the user confirms; on cancel it returns null and nothing is posted.
      void this.collectArgValues(item).then((filled) => {
        if (filled === null) return;
        const source = emitStatement(item, filled.values, filled.resultBinding, filled.rawText);
        this.host?.post({ type: 'addStatement', slot, index, source });
        this.closePopover();
      });
    }
  });
  this.mountPopover(popover); // anchored to the insertion point; Escape closes it
}
```

`collectArgValues(item)`, `mountPopover`, and `closePopover` are small DOM helpers (no innerHTML; `el`/`replaceChildren`): `collectArgValues` renders one labeled `<input>` per `item.args` entry (typed by `kind` only as a hint — all values are validated by the host parse-gate), a result-name input when `item.returnsValue`, and a single free-text input for the raw item; it resolves with `{ values: string[]; resultBinding?: string; rawText?: string }` on confirm.

- [ ] **Step 7: Styles**

In `codedWorkflow.css`, add `.cw-insert`, `.cw-stmt-wrap`, `.cw-stmt-handles`, `.cw-stmt-up/down/del`, `.cw-pal`, `.cw-pal-search`, `.cw-pal-list`, `.cw-pal-item` (theme variables only; the handles overlay on hover/selection; the palette is a small bordered popover). No new literal colors.

- [ ] **Step 8: Update the webview tsconfig + run the full suite**

The webview now emits statements (`emitStatement`), so add it and its remaining host-API-free transitive dep to `tsconfig.webview.json` `include`. `editCatalog.ts`, `editTypes.ts`, and `tier1Catalog.ts` were already added in L2.1 Step 7; `emitStatement.ts` → `editCatalog.ts` (listed) + `quoting.ts` (new) + a type from `tier1Catalog.ts` (listed). So add only the two not yet listed:

```json
    "src/model/codedWorkflow/edit/emitStatement.ts",
    "src/model/codedWorkflow/edit/quoting.ts",
```

After this the full webview-bundled `edit/` closure is listed and purity-guarded: `editCatalog.ts`, `editTypes.ts`, `emitStatement.ts`, `quoting.ts`, plus `classify/tier1Catalog.ts`.

Run: `npm run typecheck && npx vitest run && npm run build:prod`
Expected: all GREEN; the architecture test stays green — it now scans every one of those bundled files and each is host-API-free.

- [ ] **Step 9: Commit**

```bash
git add webview/ tsconfig.webview.json tests/webview/insertionPalette.test.ts
git commit -m "feat(edit): canvas insertion points + searchable palette + delete/reorder handles (L2)"
```

---

## Task L2.8: L2 milestone close — verification + E2E

**Files:** none (verification)

- [ ] **Step 1: Green gate**

Run: `npm run typecheck && npx vitest run && npm run smoke && npm run build:prod`
Expected: typecheck clean (both tsconfigs), all tests PASS, `[smoke] PASS`, build complete.

- [ ] **Step 2: Repackage + reinstall**

Run: `npx --no-install vsce package && code --install-extension uipath-artifact-designer-1.1.0.vsix --force`. Reload the window.

- [ ] **Step 3: Manual E2E on `docs/legibility/InvoiceProcessing/Workflows/IngestInvoices.cs`**

Verify, recording results:
- Toggle Edit mode → click a `+` between two statements → palette opens → search "log" → pick **Log** → fill the message → a new `Log(...)` appears at that position; `.cs` updates; one Ctrl+Z reverts.
- Pick **Assign** → fill variable + value → a `var x = …;` lands; canvas shows the tier-2 "Assign" card (round-trips).
- Pick **Raw code…** → type a custom statement → it appears as a tier-3 chip; a syntactically broken raw entry → "Edit rejected", file unchanged.
- Select a statement → press **↓** → it swaps with the next; **🗑** deletes it leaving no blank line; each is one Ctrl+Z.
- Insert into an `if/then` slot via its in-slot `+` → the statement lands inside the branch.
- Insert into a HELPER method's body (expand a `Helper: Foo()` section, click its `+`) → the statement lands in the helper, NOT silently dropped. (Regression guard for the helper `bodyId` path — if `methodId` were `''` the host's `findSlot` would no-op.)

- [ ] **Step 4: Commit a verification note**

```bash
git commit --allow-empty -m "test(edit): L2 manual E2E pass (palette add + Assign + raw + reorder + delete + undo)"
```

---

## Self-review checklist (run before handing off)

**Spec coverage (design spec → task):**
- L1 edit arguments add/remove/change (§2 L1, §4 `editArg`) → Tasks L1.1, L1.3, L1.4, L1.7.
- L1 method/overload switch (§2 L1) → L1.4 (`op: 'method'`), L1.7 (`<select>`).
- Bidirectional catalog: emit template + arg schema, pure data, palette generated from it (§7, risk #2) → L1.2 (`emit` on `CatalogEntry`), L2.1 (`editCatalog.ts` → `PALETTE_ITEMS`). **Decision recorded at top.**
- L2 statement add from palette (catalog + Assign/Add-item + raw escape) (§2 L2, §4 `emitStatement`/`placeStatement`, §6) → L2.1 (palette data), L2.2 (`emitStatement`), L2.3 (`placeStatement` insert), L2.4 (resolver), L2.7 (palette UI).
- L2 statement delete / reorder (§6) → L2.3 (`deletionPatch`/move), L2.4 (resolver), L2.7 (handles).
- Model extension: per-arg span (done L0; argSpan added L1.1), slot/container insertion offsets (§5) → L2.1 (`offsets`/`bodySpan`/`indentText`).
- Surgical patch only, never region-regenerate (§2 decision A, §3) → every resolver returns minimal `TextPatch[]` at known spans; goldens assert byte-exact, untouched-elsewhere.
- Webview never writes; host owns mutation via `WorkspaceEdit` + `lastWrittenText` echo-guard (§3, §6) → L1.6, L2.6 (clone `computeValueEdit`/provider `editValue` exactly).
- Parse-gate before applying any edit (§9) → `introducesNewError` in every `compute*`; rejection golden cases (L1.4, L2.4 implicit via host; the broken-raw E2E).
- Honesty boundary / **Fence F**: tier-3 chips move/delete as a unit + raw-only edit; expression/identifier args raw-text only (§8) → emit only catalog shapes + Assign/Add-item + raw; `editableKind` typed inputs only for literals/enums/bools/binding (carried from L0); raw escape is parse-gated user text. **Regression-guarded:** merged chips get `offsets` (L2.1) so they delete as a unit (L2.4 merged-chip delete test SUCCEEDS); the truncated fold chip stays offset-less so its delete is REJECTED (L2.4 test); the raw palette item has `args: []` (L2.7 test) and the dock's activity-only `findActivityCard` keeps chips out of the typed-field panel (L2.7 note) — so a chip never exposes typed inputs.
- No innerHTML (§6) → palette + handles + panel use `el`/`replaceChildren` only; asserted by reading `webview/util.ts` (no innerHTML anywhere).
- **Purity guard closure** (§4 boundary) → every host-API-free transitive dep of the webview-bundled `edit/` modules is added to `tsconfig.webview.json` `include` (`editCatalog`, `editTypes`, `emitStatement`, `quoting`, `classify/tier1Catalog`), so `architecture.test.ts` — which scans only literally-listed files — actually covers the whole bundled closure, not just the entry modules (L2.1 Step 7/8, L2.7 Step 8).
- Read-only default; edit toggle opt-in (§2 decision 4) → all new affordances gated on `ctx.editing`/`opts.editing` (the L0 toggle).
- Whitelist-only, deterministic, no LLM/Roslyn (§9) → emission restricted to `PALETTE_ITEMS` + raw; tree-sitter parse-gate only.
- Message-contract parity (§6) → L1.5, L2.5 add validators + `PARITY_FIXTURES`; the parity test enforces sync.
- Multi-class/multi-entry scoping (risk #5) → ids are class-qualified (`<class>#<methodSegment>/…`, overloads `@2`); `findSlot` matches a method body by its exact `bodyId` (so overloaded + empty bodies resolve); `findSiblings`/`findNodeById` walk all classes/entries/helpers; SlotRef carries `methodId`. **Helper bodies are reachable too** (L2.7 Step 6 threads `helper.bodyId` through `buildHelperSection`; without it a helper edit would post `methodId: ''` and silently no-op).
- L3 control-flow explicitly OUT (§2) → no `if`/`foreach`/`try` creation, no cross-slot moves (move is within-slot only via `findSiblings`).

**Placeholder scan:** every code step shows real code; every run step shows the command + expected result. No "add error handling"/"similar to Task N"/TBD. (The panel method-`<select>`/add-control in L1.7 Step 3 is described in prose but its remove path is the unit-asserted contract; the `<select>`/add wiring mirrors the shown remove handler — acceptable as it repeats the same `onArgEdit` call shape, not a deferred unknown.)

**Type/name consistency:**
- `OffsetSpan {start,end}` used everywhere; `TextPatch {start,end,newText}`; `EditResult` = `{ok:true;patches} | {ok:false;error}`.
- `CwActivityCard.argListSpan`, `CwArgSummary.argSpan`, `CwNodeBase.offsets`, `CwSlot/CwEntryPoint/CwHelperMethod.bodySpan`+`indentText`, `CwEntryPoint/CwHelperMethod.bodyId` — same names in `cwTypes.ts`, `buildModel.ts`, `findNode.ts` (`findSlot` matches `bodyId`), the renderer (`methodId: entry.bodyId`), and tests.
- Intents: `EditArgIntent` (`op`/`argIndex`/`newText`/`newMethod`), `AddStatementIntent` (`slot`/`index`/`source`), `DeleteStatementIntent` (`id`), `MoveStatementIntent` (`id`/`direction`), `SlotRef` (`containerId`/`methodId`/`role`/`roleIndex`) — identical in `editTypes.ts`, `messages.ts` (as message members + aliases `EditArgMessage`/`AddStatementMessage`/…), `validateMessage.ts`, fixtures.
- Functions: `editArg`, `emitStatement` (`item, argValues, resultBinding?, rawText?`), `insertionPatch`/`deletionPatch`, `findSlot`/`findSiblings`/`findNodeById`, `findPaletteItem`/`PALETTE_ITEMS`, `renderPalette`, `computeArgEdit`/`computeAddStatement`/`computeDeleteStatement`/`computeMoveStatement`/`computeStatementEdit`, `applyComputedEdit`, `renderPropertiesPanel`(+`onArgEdit`/`PropertiesArgEdit`), `RenderCtx`(+`editing`/`onInsert`/`onDelete`/`onMove`/`slot`), `openInsertPalette`/`collectArgValues`/`mountPopover`/`closePopover` (webview), `IDENTIFIER_RE` (validator) — used identically across tasks.
- Source touched by L2 fixes: `chips.ts` `mergeRun` carries `offsets` (Fence F); `buildHelperSection(className, helper)` signature change (helper `bodyId` path); `BuildModelInput.tier2Rules` JSDoc corrected ("9 shipped rules", not "currently empty").
- `el(tag,{class,text,title},children)` + `replaceChildren()` signatures match `webview/util.ts` exactly (NOT the L0 plan's positional sketch).
- VSIX name `uipath-artifact-designer-1.1.0.vsix` matches `package.json` version 1.1.0.

**Milestone/task count:** 2 milestones (L1 = M5.1, L2 = M5.2); 16 tasks total (L1: L1.1–L1.8 = 8; L2: L2.1–L2.8 = 8). Each milestone ends green (typecheck both tsconfigs + vitest + smoke + build:prod + a manual E2E pass).

## Follow-on (NOT in this plan)
- **L3 (control-flow):** add/edit `if`/`foreach`/`try`, move statements **between** slots, edit conditions — a separate spec + plan, deliberately deferred (design spec §2).
