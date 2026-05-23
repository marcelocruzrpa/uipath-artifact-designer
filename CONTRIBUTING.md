# Contributing

Thanks for your interest in improving **UiPath Artifact Designer** — a community
VS Code extension. Bug reports, feature requests, and pull requests are all
welcome.

This project is a community effort and is not affiliated with or endorsed by
UiPath.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.

## Getting help

Not sure where to start, or stuck on something? Open a GitHub issue with the
`question` label, or comment on an existing issue. This project is maintained
on a best-effort basis — replies may take a few days, sometimes longer.

## Reporting bugs & requesting features

Open an issue on GitHub. Before filing:

- Search existing issues first to avoid duplicates.
- For a **bug**, include your VS Code version, your OS, the artifact file type
  involved, and clear steps to reproduce. A minimal sample file helps a lot.
- For a **feature**, describe the use case and the problem you are trying to
  solve, not only the solution you have in mind.

## Prerequisites

- **Node.js** 18 or newer
- **VS Code** 1.84 or newer

## Getting started

```bash
git clone https://github.com/marcelocruzrpa/uipath-artifact-designer.git
cd uipath-artifact-designer
npm install
```

## Building

```bash
npm run build        # one-off development build
npm run watch        # rebuild on change
npm run build:prod   # minified production build (emits sourcemaps)
```

## Running the extension

Press **F5** and choose **"Run Extension — Samples"** to launch an Extension
Development Host with the bundled `samples/` folder open. Each sample contains a
supported artifact, so you can exercise every designer.

### Debugging the webview

The graph canvas and inspector run inside a VS Code webview, separately from
the Extension Host. To inspect their DOM or `console` output, open the Command
Palette in the Extension Development Host and run
**Developer: Open Webview Developer Tools**.

## Testing

```bash
npm test             # run the Vitest suite once
npm run test:watch   # re-run on change
```

Tests cover the pure model and validation code — `parse*`, `edit*`, and the
webview message validation — including round-trip, cascading-delete, and
regression cases. Please add or update tests for any model or validation change,
and keep the suite green.

## Type-checking

```bash
npm run typecheck    # type-check the host and webview bundles
```

## Packaging

```bash
npm run package      # produce a .vsix
```

`@vscode/vsce` is already a `devDependency`, so `npm install` covers it.

## Architecture

The extension is an **artifact-designer registry**. A single generic
`CustomTextEditorProvider` is registered for every supported file type; for each
document it resolves an **artifact descriptor** (`detect` / `loadModel` /
`applyEdit`) and the webview shell mounts the matching **renderer**. Adding a
new artifact type is a new descriptor plus a new renderer — no changes to the
core.

| Path | Purpose |
|------|---------|
| `src/extension.ts` | Activation; registers the provider and commands for every artifact kind. |
| `src/artifactEditorProvider.ts` | The generic `CustomTextEditorProvider`; routes edits to descriptors. |
| `src/model/registry.ts` | Maps each artifact kind to its descriptor. |
| `src/artifacts/` | One descriptor per artifact kind (`detect` / `loadModel` / `applyEdit`). |
| `src/model/` | Per-kind parsers, the normalized models, and edit helpers. |
| `webview/rendererRegistry.ts` | Maps each artifact kind to its webview renderer. |
| `webview/renderers/` | One renderer per artifact kind (canvas or form). |
| `webview/` | The shared shell, the graph canvas, inspector, and styles. |

## Submitting changes

1. Fork the repository and create a topic branch off `main`.
2. Make your change in focused commits with clear messages.
3. Before opening a pull request, make sure these all pass:
   ```bash
   npm run typecheck
   npm test
   npm run build:prod
   ```
4. Open a pull request describing **what** changed and **why**, and link any
   related issue.
5. If your change is user-visible, add an entry under the `[Unreleased]` heading
   in [`CHANGELOG.md`](CHANGELOG.md).

CI runs the type-check, test, and production build on every pull request — the
same three commands above.

## Coding conventions

- TypeScript throughout; match the style of the surrounding code.
- The host (`src/`) and webview (`webview/`) are separate bundles, type-checked
  independently — keep their code and imports separate.
- The extension ships a deliberately small runtime dependency surface; avoid
  adding a new runtime dependency without a clear reason.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
