# Changelog

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.2] - 2026-05-24

Bug-fix release. Restores rendering of every visual designer under the
Marketplace and Open VSX install paths, where v1.0.0 / v1.0.1 opened to a
blank canvas with the toolbar visible.

### Fixed

- **Blank-canvas regression in installed mode.** A defensive
  `event.source` identity check in the webview's window-message listener
  rejected legitimate host messages on VS Code and Cursor builds that
  route the extension host's `postMessage` through a worker /
  service-worker frame (where `event.source` is neither `window.parent`
  nor `window`). Every `model` / `fallback` / `error` / `control`
  message from the host was silently dropped, so `applyModel` never
  ran and the canvas stayed blank across all five designer types. The
  source-identity guard is replaced with a shape check on `message.type`
  — the VS Code webview iframe is already sandboxed, and the host-side
  `validateWebviewMessage` is the real trust boundary for anything that
  writes to disk.

### Added

- **Post-install reload prompt.** The extension now watches its own
  `dist/extension.js` and `dist/webview.js` for in-place updates and
  shows "UiPath Artifact Designer was updated on disk. Reload the
  window to apply." with a `Reload Window` action. Closes the gap
  where VS Code's built-in reload notification does not fire after a
  same-version VSIX reinstall.
- **Startup watchdog in the webview.** If the extension host does not
  respond within 1.2 s of the first `ready` post, the webview re-sends
  `ready` once (handles activation races). At 5 s with still no
  response, a visible red error strip appears so a future regression of
  this silent-blank class is diagnosable from the UI itself, no
  DevTools required.

### Changed

- **Renderer failures now surface as a red error strip.** A throw
  inside `applyModel` (renderer mount or update) used to leave the
  canvas silently blank. It is now caught, the renderer is disposed
  cleanly, and the user sees `UiPath Designer: renderer failed — <msg>`.

### Internal

- **Eager activation.** Added `onStartupFinished` to `activationEvents`
  so the bundle watcher installs at startup time rather than waiting
  for a designer file to be opened.
- **Packaging hygiene.** `.vscodeignore` now excludes `tmp-profile/`
  directories, preventing stray test-profile contents created by
  failed `code --install-extension` attempts from being silently
  bundled into the VSIX.

## [1.0.1] - 2026-05-23

Maintenance release. Refreshes the Marketplace and Open VSX listings with the
full-resolution icon, and updates the README to reflect that the extension is
now published to both stores.

### Changed

- **High-resolution icon.** Bundled the full-resolution Marketplace / Open VSX
  listing icon (`icon.png`: 91 KB → 1.4 MB). No functional change; the
  store listing icons now match the intended artwork.
- **README install paths.** Documented the VS Code Marketplace, Open VSX, and
  manual `.vsix` install paths. Replaced the placeholder badge block with
  live badges; the Marketplace badge uses a dynamic shields.io endpoint so
  it tracks the published version automatically. Dropped the "not yet
  published" and "no Marketplace icon yet" caveats.

## [1.0.0] - 2026-05-23

The first public release. UiPath Artifact Designer provides visual designers
for five UiPath artifact types — low-code agents, Maestro Flow, BPMN, Case, and
Coded Apps — inside VS Code, built on a layered host/webview architecture with
a registry-driven artifact-descriptor pattern.

### Added

- **README screenshots.** Each of the five designers (`agent.json`,
  `*.flow`, `*.bpmn`, `caseplan.json`, `action-schema.json`) has a screenshot
  in the README.
- **Multi-artifact designer registry.** A single generic
  `CustomTextEditorProvider` handles every supported file type; per-kind
  descriptors (`detect` / `loadModel` / `applyEdit`) and per-kind webview
  renderers sit behind a shared shell. Adding a new artifact type is a new
  descriptor plus a new renderer — no changes to the core.
- **Low-code agent designer (`agent.json`).** Studio-Web-style node graph with
  the agent at the center, tools / contexts / escalations around it, and an
  editable inspector. Renders a **Memory** node showing the agent's
  conversation-memory capability (`metadata.agentMemory`), enabled or disabled,
  with an editable toggle. Name, description, model, temperature, max tokens,
  max iterations, system & user prompts, and input/output arguments are all
  editable; `contentTokens` regenerates automatically, and arguments stay in
  sync with `entry-points.json`.
- **Maestro Flow designer (`*.flow`).** Node-graph canvas with `dagre`
  auto-layout (stored coordinates honored), node drag, and a per-node-type
  inspector.
- **Maestro BPMN designer (`*.bpmn`).** Full BPMN 2.0 modeler embedding
  `bpmn-js`. UiPath `uipath:*` extension XML round-trips losslessly on save
  via a UiPath moddle extension. BPMN XML is validated before write; empty,
  non-BPMN, or truncated exports are rejected with a warning instead of
  corrupting the file. Files larger than 2 MB are rejected before writing to
  disk.
- **Maestro Case designer (`caseplan.json`).** Stage-graph canvas supporting
  both v19 and v20 schemas, with stage / edge / entry & exit condition / SLA
  editing.
- **Coded App designer (`action-schema.json`).** Form editor for the
  inputs / outputs / inOuts / outcomes data contract, with a read-only
  `.uipath/app.config.json` deployment-status panel.
- **Layered host/webview architecture.** The pure model layer in `src/model/`
  is enforceably free of `vscode` imports (host-only `loadProject` lives in
  `src/host/`). The webview tsconfig safely shares the whole model layer; an
  architecture guardrail test asserts that every `src/` file shared with the
  webview bundle is free of host-only imports (`vscode`, `fs`, `path`,
  `node:*`).
- **Per-document serialized edit queue.** Every edit re-reads the latest text
  and applies in order, so concurrent webview messages cannot overwrite one
  another's full-document writes. A `disposed` flag short-circuits in-flight
  continuations after the webview panel is disposed.
- **Schema-field preservation on edit.** Editing arguments or an action schema
  merges onto the existing on-disk objects, so unknown or future schema
  keywords (`default`, `enum`, custom `x-uipath-*` keys) survive a save.
- **Error surfacing.** Handler errors inside the edit queue are surfaced to
  the webview as an error banner, and the model is force-resynced from disk
  so the inspector reflects reality instead of the last user input.
- **"UiPath: Open Designer" cold-start.** The command from a fresh VS Code
  window activates the extension via `onCommand` wired into
  `activationEvents`.
- **Shared JSON-shape helpers (`src/util/jsonShape.ts`).** A consistent set
  of `asRecord` / `asString` / `asArray` helpers used across model files,
  with dedicated tests.
- **Accessibility.** Node cards expose `role`, `aria-label`, and selection
  state, with keyboard navigation and a visible focus ring on the canvas.
- **Automated test suite.** Vitest unit tests cover the pure model and
  validation code (`parse*`, `edit*`, message validation), including
  round-trip, cascading-delete, and regression coverage. 120 tests, all
  passing.
- **Message-contract parity test.** Asserts every `WebviewToHost` union
  member is exercised by the runtime validator, so drift between
  `messages.ts` and `validateMessage.ts` fails the build instead of crashing
  the host on a real message.
- **Performance.** Canvas drags update only the edges touching the dragged
  node instead of clearing and rebuilding the whole edge layer on every
  pointer move; model updates use section-level dirty checks instead of a
  full DOM rebuild. File-watcher events debounce at 200 ms; text-document
  changes debounce at 400 ms so re-renders do not fire mid-keystroke when a
  sibling file is edited as text in another tab. The editor provider tracks
  the active panel via `onDidChangeViewState` instead of scanning every
  panel on every command invocation.
- **Production sourcemaps.** The production build emits sourcemaps to aid
  field debugging; minification is unchanged.
- **Marketplace metadata.** `repository`, `bugs`, `homepage`, `icon`,
  `publisher`, `author`, and an `onCommand` activation event are declared in
  `package.json`.

### Security

- **Runtime validation of webview messages.** Messages crossing the
  webview→host boundary are decoded against their declared type before
  dispatch — string-length caps, finite-number checks, enum checks, and a
  denylist of `__proto__` / `prototype` / `constructor` /
  `__defineGetter__` / `__defineSetter__` / `__lookupGetter__` /
  `__lookupSetter__` / `then` for any string used as a JSON edit-path key
  (closes the prototype-pollution and thenable-injection vectors).
- **Path-traversal guard.** The host's `isInside` check normalizes case on
  Windows file URIs and rejects any path segment of `..`, so a webview
  cannot reach files outside the project via crafted `openResource` URIs.
- **Object-array guards on case validators.** `caseSetConditions` and
  `caseSetSlaRules` reject primitives and nested arrays before they reach
  `caseplan.json`.
- **`tryReadJson` size cap.** Workspace JSON reads stat first and refuse
  files larger than 5 MB, bounding the host memory footprint in hostile
  workspaces.
- **CSPRNG everywhere.** The CSP nonce uses `crypto.randomBytes`; case-stage
  id generation (`prefixedId`) uses `globalThis.crypto.getRandomValues` for
  entropy parity instead of `Math.random()`.
- **Vulnerability hygiene.** Vitest 4.x, `esbuild` 0.28, `@types/node` ^20 —
  closes all four moderate dev-only CVEs from the prior `npm audit`.
