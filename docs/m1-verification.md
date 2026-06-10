# M1 Manual Verification Checklist

**Milestone:** M1 — Coded Workflow Canvas (feat/coded-workflow-canvas)
**Gate:** G1 — Canvas renders, live-updates, and degrades gracefully
**Demo workspace:** `samples/coded-workflow-demo/`
**Estimated time:** ~10 minutes

## Setup

1. Open the repo in VS Code (or Cursor).
2. Press **F5** — the Extension Development Host launches with the extension loaded.
3. In the EDH window, open the folder `samples/coded-workflow-demo/` via **File → Open Folder**.

---

## Checks

| # | Step | Expected result | Requirement |
|---|------|-----------------|-------------|
| 1 | Open `Workflows/ProcessInvoices.cs` normally (single-click or **Open With → Text Editor**) | File opens as a **plain text / syntax-highlighted C# editor** — the canvas does NOT open automatically | R1 — blast radius: `priority: "option"` means VS Code never hijacks `.cs` files by default |
| 1b | With `ProcessInvoices.cs` open as text, inspect the editor **title bar** | The **`$(type-hierarchy)` "Open Designer" icon button** is visible in the title bar actions | Context key `uipathArtifactDesigner.activeCsIsWorkflow` is `true`; menu `when` clause fires |
| 2 | Click the **Open Designer** button (or run `UiPath: Open Designer` from the Command Palette) | Canvas opens in a **side-by-side custom editor**: header row shows workflow name + argument pills (`invoiceFolder: string`), stat chips (line count, activity count); tier-1 cards visible for `Log(…)`, `system.GetAsset(…)`, `system.AddQueueItem(…)`, `workflows.ValidateInvoice(…)`, `RunWorkflow(…)`; containers rendered for `if`, `foreach`, `try/catch` (stacked); plain C# statements show as collapsed grey chips | R2 (tier-1 cards), R3 (containers), R4 (grey chips collapsed) |
| 2b | Click any grey chip to **expand** it | Chip expands to show the **exact source code** of that statement; clicking again collapses it | R4 — chip expand/collapse |
| 3 | With the canvas open alongside the text editor, **type a change** in the text side (e.g., add a blank line or change a string literal) | After ~400 ms the canvas **re-renders** to reflect the edit; no full page reload / flicker | R7 — debounced live update on `onDidChangeTextDocument` |
| 4 | From the EDH integrated terminal, run: `Add-Content "Workflows/ProcessInvoices.cs" 'Log("agent-edit-probe");'` | Within **< 1 s** the canvas updates with the new `Log(…)` card **without** the file having focus in the editor | R7 — agent / external-edit path (`onDidChangeTextDocument` fires regardless of focus) |
| 5 | In the text editor, **delete a `}` brace** in the middle of `Execute(…)` (introduce a parse error) | Canvas shows an **amber "Stale — showing last good render" pill** overlaid on the last valid canvas; NO blank page / error screen / exception toast | R8 — graceful stale-render on broken syntax |
| 5b | Re-type the missing `}` to restore valid syntax | Amber pill disappears; canvas **recovers** to the corrected model within the debounce window | R8 — recovery from stale state |
| 6 | Open `Helpers/InvoiceHelpers.cs` → click **Open Designer** | Canvas shows the **"Not a coded workflow" fallback screen** with an explanatory message and a **"Reopen as Text"** button; clicking it switches back to the text editor | R1 / Story 6 — helper-class fallback; `uipathArtifactDesigner.activeCsIsWorkflow` is `false` for non-workflow files |
| 7 | Open `tests/fixtures/codedWorkflow/scale/two-thousand-lines.cs` → click **Open Designer** | Canvas renders with **containers collapsed by default**; scrolling through the canvas is **smooth** (no jank, no timeout); header stat pill shows a high activity count | R11 — performance: ≤ 250 ms parse+model on 2 k-line file (proven by CI; visually confirm no hang) |
| 8 | With the canvas open on `ProcessInvoices.cs`, **expand two chips and scroll** the canvas, then switch to a different editor tab and **switch back** | Canvas **preserves collapse/scroll state exactly** — previously expanded chips are still expanded; scroll position is restored | `retainContextWhenHidden: true` in the webview options |
| 9 | Open VS Code **Settings → Color Theme** and switch to a **light theme** (e.g., "Light Modern") | Canvas repaints using light-theme CSS variables — card backgrounds, chip colours, text, and border colours all respect the active theme; no invisible white-on-white text | Theming — CSS `var(--vscode-*)` tokens |

---

## Automated Evidence (already proven by CI)

The following properties are covered by the automated test suite and do **not** need to be re-verified manually during M1 gate review:

| Claim | Evidence |
|-------|----------|
| **326 unit tests pass** across 27 test files (model classification, container nesting, chip merging, excel handles, detection, architecture, edit-queue) | `npm test` → `Tests 326 passed (326)` |
| **Parser + model builds in ≤ 250 ms** on the 2 000-line scale fixture (R11) | `tests/fixtures/codedWorkflow/scale/two-thousand-lines.cs` perf test in CI |
| **VSIX size ≤ 2.18 MB** with wasm bundled (`dist/tree-sitter.wasm` included, `samples/**` excluded) | `uipath-artifact-designer-1.0.2.vsix` — `.vscodeignore` excludes `samples/**`, `tests/**`, `docs/**`, `src/**` |
| **Detection** correctly identifies coded workflows vs helper classes vs non-workflow `.cs` files | `tests/fixtures/codedWorkflow/detection/` fixtures + detection test suite |
| **Stale-render model** (broken syntax → last-good cached model) | `tests/fixtures/codedWorkflow/expected/broken-syntax.model.json` + model test |
| **Chip merging** produces correct collapsed groups | `tests/fixtures/codedWorkflow/expected/chips-merge.model.json` + model test |
| **Excel handles** (using-resource containers with object props) | `tests/fixtures/codedWorkflow/expected/excel-handles.model.json` + model test |

---

## Gate G1 Sign-off

All 9 manual checks above must be marked **PASS** before merging `feat/coded-workflow-canvas` → `main`.

| Reviewer | Date | Result |
|----------|------|--------|
| | | ☐ PASS  ☐ FAIL |
