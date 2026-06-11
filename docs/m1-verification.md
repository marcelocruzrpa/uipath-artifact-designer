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

---

## M2 — Call graph

**Milestone:** M2 — Project call graph (T2.1–T2.4)
**Gate:** G2 — Graph is correct, deterministic, fast, and navigable
**Demo workspace:** `samples/coded-workflow-demo/`

### Automated evidence (already proven by CI / scripts)

| Claim | Evidence |
|-------|----------|
| **Fixture-map e2e**: real parses of the 5-file `sampleProject` fixture assemble into the exact expected 8-node / 7-edge map (unique + ambiguous `workflows.*` resolution, legacy xaml node, helper edge, dynamic-RunWorkflow singleton, no-match node, entry badge only on `Workflows/Main.cs`) | `tests/model/codedWorkflow/graphAssemble.test.ts` → `assembleGraph — sampleProject fixture end-to-end › produces the expected project map` |
| **Assembly determinism**: identical graph JSON across runs and regardless of input file order | `graphAssemble.test.ts` → `assembleGraph — cap, aggregation, determinism › is deterministic: identical output across runs and input file order` |
| **Layout determinism**: two dagre layout runs over the same graph are byte-identical | `tests/webview/graphLayout.test.ts` → `layoutGraph › is deterministic — two runs over the same graph are identical` |
| **Node cap / truncation**: helpers dropped first, then unresolved; coded + xaml nodes never dropped; no dangling edges | `graphAssemble.test.ts` cap suite |

### Performance evidence (G2 budgets: cold ≤ 1500 ms @ 50 files, increment ≤ 100 ms)

Measured with `npx tsx scripts/graphPerf.mjs` over deterministic generated projects
(`scripts/genSampleProject.mjs` — chained `workflows.*` calls, literal + dynamic
`RunWorkflow`, 5 static helpers). The script measures the **pure pipeline**
(read → tree-sitter parse → `extractFileFacts` → `assembleGraph`) in plain Node —
the host index (`src/artifacts/codedProjectIndex.ts`) is thin stat-cache glue over
exactly this pipeline, so this is the honest cold-build cost. The host's warm
rebuild is stat-only and cannot be measured purely; instead the **warm increment**
(re-parse ONE file + re-assemble from cached facts — the cost of a single-file
edit) is measured.

**Machine:** Intel Core Ultra 9 185H, 32 GB RAM, Windows 11 Home, Node v25.6.1 — measured 2026-06-11.

| n   | .cs files | cold total (ms) | read | parse | facts | assemble | increment (ms, median of 5) | nodes | edges | truncated |
| --- | --------- | --------------- | ---- | ----- | ----- | -------- | --------------------------- | ----- | ----- | --------- |
| 50  | 55        | 122.6           | 5.4  | 74.5  | 39.4  | 3.4      | 3.2                         | 64    | 113   | false     |
| 150 | 155       | 141.4           | 13.9 | 75.5  | 49.1  | 3.0      | 5.2                         | 178   | 336   | false     |

- **cold(50) = 122.6 ms ≤ 1500 ms — PASS** (~12× headroom; a repeat run measured 136.4 ms — same order)
- **increment(50) = 3.2 ms ≤ 100 ms — PASS**; increment(150) = 5.2 ms — PASS (assembly is pure recompute, ~3 ms)
- One-time parser init (wasm load, paid at host activation, not per build): ~40 ms — cold(50) + init still ≪ budget.
- Node-kind sanity at n=50: 50 coded-workflow + 8 xaml (every 7th file) + 5 helper + 1 dynamic-unresolved = 64 — exactly the generated shape.

### Manual EDH checks

Setup as in M1 (F5 → EDH → open `samples/coded-workflow-demo/`).

| # | Step | Expected result | Requirement |
|---|------|-----------------|-------------|
| M2-1 | Open `Workflows/ProcessInvoices.cs` → click **Open Designer** | Canvas opens; the header shows the segmented **`Workflow \| Call graph`** control — the **Call graph** tab appears (a project graph exists) | T2.3 — mode tabs built only when a graph exists |
| M2-2 | Click the **Call graph** tab | Graph view: nodes for **ProcessInvoices** and **ValidateInvoice** (entry badge on ProcessInvoices — the `project.json` entry point); an **XAML node for `Legacy/Archive.xaml`** with a **dashed border**, marked **target-file-missing** (the file does not exist in the demo); edges include the **solid `workflows.ValidateInvoice` edge** from ProcessInvoices | R6 — never-drop (missing xaml still shown, dashed); resolution rules |
| M2-3 | Click the **ValidateInvoice** node | `Workflows/ValidateInvoice.cs` **opens in the editor** — node navigation resolves URIs via the **project root**, so it works across folders too | T2.3 — node click → open file |
| M2-4 | Focus the plain **text editor** on `ProcessInvoices.cs` and run **`UiPath: Show Call Graph`** from the Command Palette | The designer **opens already on the graph view** (not the canvas) | `uipathArtifactDesigner.showCallGraph` command + control message |
| M2-5 | With the graph visible, edit a `.cs` file **externally** (e.g. `Add-Content "Workflows/ValidateInvoice.cs" '// probe'` from the EDH terminal) | The graph **refreshes** within the debounce window — no manual reload needed | R7 — live update reaches the graph mode |
| M2-6 | Watch the graph header/overlay throughout all checks above | The truncation chip (**"Graph truncated — showing workflows only"**) **never shows** on this small project (well under the 300-node cap) | Node cap only engages over 300 nodes |

### Gate G2 Sign-off

All 6 manual checks above must be marked **PASS** (with the automated + perf evidence green) before M2 is accepted.

| Reviewer | Date | Result |
|----------|------|--------|
| | | ☐ PASS  ☐ FAIL |
