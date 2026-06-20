# Canvas → Code Editing (v2) — Design Spec

**Date:** 2026-06-14
**Status:** Approved in brainstorming; pending spec review → implementation plan.
**Relates to:** the read-only Coded Automation Canvas (v1), shipped on branch `feat/coded-workflow-canvas`. This feature is **additive** — v1 stays read-only and shippable; editing rides on top as a later milestone (M5).

## 1. Context & intent

The v1 canvas renders a UiPath coded automation (C# `CodedWorkflow`) as a read-only visual canvas so low-code developers can *verify* coding-agent output without reading C#. First hands-on feedback: developers coming from Studio expect a **properties panel** where they can not only read an activity's properties but **edit** them — and, more broadly, edit the workflow structurally from the canvas.

This spec turns the canvas from a read-only *view* into a visual *editor* that round-trips to C#. The north-star is full structural editing (a "visual Studio" for coded workflows). That is a multi-milestone product, so it is decomposed into layers; this spec covers the **first slice**.

## 2. Scope (decisions locked in brainstorming)

This slice = **L0 + L1 + L2**. L3 (control-flow / container editing) is explicitly deferred to a later spec.

| Layer | Capability | In this slice |
| --- | --- | --- |
| **L0** | Edit leaf **values** of existing activities (string/number/bool literals, enum members, the result-binding name) | ✅ |
| **L1** | Edit **arguments** — add/remove optional args, switch a catalog method/overload | ✅ |
| **L2** | **Statement** add (from a palette) / delete / reorder within a slot | ✅ |
| **L3** | Control-flow editing — add/edit `if`/`foreach`/`try`, move statements **between** slots, edit conditions | ❌ deferred |

**Locked decisions:**
1. **Edit scope:** full structural is the north-star; we build L0+L1+L2 first (a visibly-editable canvas, including the first real C# emission).
2. **Add palette:** recognized **tier-1 catalog activities** + common **tier-2 steps** (Assign, Add item) emit correct C#, **plus a raw-code escape hatch** (free-text statement → tier-3 chip).
3. **Write-back architecture: Surgical patch (A).** Every edit is a minimal `WorkspaceEdit` at a known source span; nothing outside the edit changes. Rejected: region regeneration (B) and hybrid (C) — both corrupt comments/formatting/chip internals because the model is deliberately lossy.
4. **Read-only stays the default.** Editing is opt-in via an edit-mode toggle; opening a `.cs` still gives the safe read-only canvas.

## 3. Architecture — the reverse path

v1 is one-way: `parse (tree-sitter) → buildModel → IR → webview render`. Editing adds the mirror path. **Cardinal rule: the webview never writes.** It emits a typed *edit intent*; the host owns every text mutation through `vscode.WorkspaceEdit` on the underlying `TextDocument`.

```
webview (select + edit intent)  ──▶  host edit resolver  ──▶  parse-gate ──▶  vscode.WorkspaceEdit
        ▲                                                                              │
        └──────── re-render ◀── buildModel ◀── re-parse ◀── onDidChangeTextDocument ◀──┘
                              (the existing live-reload loop + lastWrittenText echo-guard, unchanged)
```

Consequences of routing through `WorkspaceEdit`:
- **Undo/redo, dirty state, and re-render are native** — we reuse the existing live-reload loop in `src/artifactEditorProvider.ts` and its `lastWrittenText` echo-guard; no new mutation machinery.
- A surgical patch **cannot corrupt code it does not touch** — comments, formatting, and raw tier-3 chips outside the edit stay byte-identical.

## 4. The edit resolver (the heart — pure, host-side, vscode-free)

New pure module tree `src/model/codedWorkflow/edit/` (same purity boundary as the rest of `src/model/codedWorkflow/` — imports only `web-tree-sitter`, enforced by `tests/architecture.test.ts` + `tsconfig.webview.json`). One entry point:

```ts
// edit/resolveEdit.ts
resolveEdit(source: string, model: CodedWorkflowModel, intent: EditIntent): EditResult
//   EditResult = { ok: true; patches: TextPatch[] } | { ok: false; error: EditError }
//   TextPatch  = { start: number; end: number; newText: string }   // char offsets into `source`
```

Sub-modules (one responsibility each, independently testable):
- `editValue.ts` — replace one arg/binding **span** (e.g. the `"InvoicesToValidate"` string literal).
- `editArg.ts` — splice inside an `argument_list` (add/remove/replace an argument; switch method name).
- `emitStatement.ts` — the **C# emission engine**: `(catalogActivity, argValues) → one statement's source` (e.g. `system.AddQueueItem("Retries", item);`). The inverse of the tier-1 catalog. Emits exactly one statement, never a method.
- `placeStatement.ts` — span arithmetic for placement: the insert offset + inferred indentation for add/move, the deletion range for delete.

Purity makes it **golden-testable exactly like the tier-2 rules**: `(source, intent) → resulting source`, byte-exact.

## 5. Model extension (what makes surgical edits possible)

The IR (`cwTypes.ts`) already spans every *node*. Two minimal additions:
- `CwArgSummary` gains a `span: SourceSpan` (the argument's exact source range), so a value/arg edit targets an exact byte range.
- `CwSlot` (and/or `CwContainer`) gains the **insertion offsets** it needs — the slot's open-brace/close-brace (or block boundary) offsets and the inter-statement positions — so a statement add/move/delete can compute a target offset.

`buildModel.ts` is extended to populate these; the rest of classification is untouched. Goldens regenerate (spans added).

## 6. Components (webview + host)

- **Properties panel** — `webview/renderers/codedWorkflow/propertiesPanel.ts`. Docked right, reflects `selectedId`. Typed fields for literals/enums/bools/the binding name; raw-text fields (with an "expression" note) for expressions/chips. Commits an edit intent on blur/enter. In read-only mode the same panel renders **disabled**, doubling as the read-only inspector. No `innerHTML` (repo security rule) — built with the existing `el`/`clearChildren` DOM helpers.
- **Add affordances** — a `+` insertion point between/around statements opens a searchable **palette** (catalog activities + Assign/Add-item + "raw code") → an `addStatement` intent.
- **Reorder / delete** — drag-handle or up/down on a selected statement → `moveStatement`; a delete action → `deleteStatement`.
- **Edit-mode toggle** — read-only is the **default**; a pencil toggle opts in. `WebviewViewState` gains `editing?: boolean` (validator + parity fixtures updated).
- **New messages** (webview→host): `editValue`, `editArg`, `addStatement`, `deleteStatement`, `moveStatement` in `src/util/messages.ts`; `validateMessage.ts` validators; the message-contract parity test forces these to stay in sync.
- **Host handler** — the provider receives an intent → `resolveEdit` → parse-gate → `WorkspaceEdit`. Cloned in spirit from the existing `openResource` host handler. The descriptor's `applyEdit` (currently a no-op, R9) is **not** the path used — edits mutate the `TextDocument` directly via `WorkspaceEdit`, the standard `CustomTextEditor` pattern.

## 7. The bidirectional catalog

`tier1Catalog.ts` today describes how to **render** a recognized call. For add/edit we add the inverse: each addable activity gets an **emit template** + a small arg schema (label, type, required?). Kept as pure data (template strings, no functions); the emission engine substitutes user values; the **palette is generated from it**. Likely an `emit` field on `CatalogEntry` or a parallel `editCatalog.ts` — to be settled in the plan.

## 8. The honesty boundary (the read-only fence, carried into edit mode)

The product's honesty principle — *never pretend to understand more than we do* — holds in edit mode:
- **Tier-3 chips** — movable and deletable as a unit, and editable only as **raw text** (the whole block). Never field-edited; we don't model their internals.
- **Expression / identifier args** — panel shows them as **raw-text fields with a note**; only literals/enums/bools/binding-names get typed inputs.
- We synthesize **only** catalog shapes. Anything riskier is raw text the user owns, validated by the parse-gate. We never emit code we can't round-trip.

## 9. Safety & error handling

- **Parse-gate** — before applying any edit, re-parse the would-be-patched source with tree-sitter. If it introduces a new ERROR node (or loses the entry-point structure), **reject** the edit and surface a transient notice; nothing is written.
- **Emission** is restricted to catalog shapes (known-good) and the raw escape (user text, parse-gated).
- **Undo/redo** is native (the `WorkspaceEdit` participates in the document's undo stack).
- **Live-reload coordination** — the `lastWrittenText` echo-guard already prevents the canvas from re-rendering twice off its own write; if the user is also editing the text buffer, the `TextDocument` is the single source of truth (last write wins).
- **Edit mode off by default** — a `.cs` opens to the read-only canvas; editing is a deliberate toggle.

## 10. Testing

- **Pure `resolveEdit` goldens** (the bulk) — `(source, model, intent) → resulting source`, byte-exact, mirroring the tier-2 golden harness (`tests/model/codedWorkflow/tier2Golden.test.ts`). One per edit kind, plus parse-gate **rejection** cases and the chip/expression boundary.
- **Emission goldens** — `(catalogActivity, args) → C# statement`, byte-exact.
- **Round-trip invariant** — after an edit, assert **only the patched span changed** (every other byte identical) and that re-`buildModel` reflects the change.
- **Webview** — panel field rendering + intent emission (jsdom/pure), and `editing` state in `WebviewViewState` round-trips through the validator.
- **Manual E2E** — in the installed VSIX: select → edit a value → `.cs` updates + re-renders + one-Ctrl+Z undo; add an activity from the palette; reorder; delete; raw-escape insert.

## 11. Milestone breakdown (this slice)

- **M5.0 (L0)** — edit-intent plumbing (messages + validators + host handler) + properties panel (read + value edit) + per-arg spans + parse-gate + native undo. **Ships the properties-panel-with-write for values** — the original ask.
- **M5.1 (L1)** — argument add/remove/change + method/overload switch (`editArg` + arg-splice emission + the editable arg schema).
- **M5.2 (L2)** — statement add (palette + `emitStatement` + `placeStatement`) / delete / reorder + the raw-code escape hatch.

Each milestone is independently shippable and ends green (typecheck + tests + bundle smoke + a manual E2E pass).

## 12. Risks & open questions (for the plan to resolve)

1. **Indentation/placement inference** for `addStatement`/`moveStatement` — derive from neighboring statements' leading whitespace; needs care for first/last-in-slot and block-less bodies.
2. **Emit-template location** — `emit` field on `CatalogEntry` vs a parallel `editCatalog.ts`. Decide in the plan; keep it pure data.
3. **Selection ↔ source nav** — selection already exists (`selectedId`, `data-id`); the panel binds to it. A "reveal in code" jump is a cheap add (one message, cloned from `openResource`).
4. **Parse-gate strictness** — "no *new* ERROR node vs the pre-edit tree" is the proposed rule (tree-sitter only; no Roslyn/compile check, per the v1 no-.NET fence). Confirm this is sufficient.
5. **Multi-class / multi-entry files** — edits are scoped by node `id` (already class-qualified), so this should fall out for free; verify in tests.
