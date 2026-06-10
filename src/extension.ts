import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ArtifactEditorProvider } from './artifactEditorProvider';
import { findProjectRoot } from './artifacts/codedProject';
import { CodedProjectIndex } from './artifacts/codedProjectIndex';
import { VIEW_TYPES } from './constants';
import { artifactRegistry, descriptorForUri } from './model/registry';
import { isCodedWorkflowSource } from './model/codedWorkflow/detectSource';
import { configureCSharpParser, disposeCSharpParser } from './model/codedWorkflow/parser';
import { initLog, logError, logInfo, logWarn } from './util/log';

/** Resolves the artifact URI to open a designer for, from a command argument. */
function pickArtifactUri(argUri: vscode.Uri | undefined): vscode.Uri | undefined {
  if (argUri && descriptorForUri(argUri)) {
    return argUri;
  }
  const active = vscode.window.activeTextEditor;
  if (active && descriptorForUri(active.document.uri)) {
    return active.document.uri;
  }
  return undefined;
}

/**
 * Watches the extension's own bundles for in-place updates and prompts the
 * user to reload the window. VS Code's built-in reload notification only
 * fires when an extension's version changes; a same-version VSIX reinstall
 * (or any out-of-band file replacement) leaves the stale code running with
 * no signal to the user. This closes that gap.
 *
 * Uses Node's `fs.watch` rather than `vscode.workspace.createFileSystemWatcher`
 * because the latter is workspace-scoped and won't see changes inside the
 * extension install directory.
 */
function installReloadWatcher(context: vscode.ExtensionContext): void {
  const distDir = path.join(context.extensionPath, 'dist');
  const watchedFiles = ['extension.js', 'webview.js'];

  const hashFile = (filePath: string): string | null => {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
      return null;
    }
  };

  const initialHashes = new Map<string, string | null>();
  for (const name of watchedFiles) {
    initialHashes.set(name, hashFile(path.join(distDir, name)));
  }

  let prompted = false;
  const checkChanged = (): void => {
    if (prompted) {
      return;
    }
    for (const name of watchedFiles) {
      const current = hashFile(path.join(distDir, name));
      if (current !== null && current !== initialHashes.get(name)) {
        prompted = true;
        void vscode.window
          .showInformationMessage(
            'UiPath Artifact Designer was updated on disk. Reload the window to apply.',
            'Reload Window'
          )
          .then((choice) => {
            if (choice === 'Reload Window') {
              void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        return;
      }
    }
  };

  // fs.watchFile polls instead of relying on the OS watcher API — fs.watch
  // is notoriously flaky on Windows (events occasionally never fire after a
  // file replacement). For two small files polled every 2 s the overhead is
  // negligible, and we get rock-solid cross-platform behavior.
  const onChange = (curr: fs.Stats, prev: fs.Stats): void => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      checkChanged();
    }
  };
  const watchedPaths = watchedFiles.map((name) => path.join(distDir, name));
  try {
    for (const p of watchedPaths) {
      fs.watchFile(p, { interval: 2000, persistent: false }, onChange);
    }
  } catch (e) {
    logWarn(
      `reload watcher could not be installed: ${e instanceof Error ? e.message : String(e)}`
    );
    return;
  }

  context.subscriptions.push({
    dispose: () => {
      for (const p of watchedPaths) {
        fs.unwatchFile(p, onChange);
      }
    }
  });
}

/**
 * Keeps the `uipathArtifactDesigner.activeCsIsWorkflow` context key in sync
 * with the active editor. It drives the editor-title "Open Designer" button
 * on `.cs` files: shown only when the file actually looks like a coded
 * workflow, so plain C# files never grow a designer affordance.
 */
function installCsWorkflowContextKey(context: vscode.ExtensionContext): void {
  const CONTEXT_KEY = 'uipathArtifactDesigner.activeCsIsWorkflow';

  const setKey = (value: boolean): void => {
    vscode.commands
      .executeCommand('setContext', CONTEXT_KEY, value)
      .then(undefined, (e: unknown) => logError('setContext failed', e));
  };

  const evaluate = (document: vscode.TextDocument | undefined): void => {
    const isWorkflow =
      document !== undefined &&
      document.uri.path.toLowerCase().endsWith('.cs') &&
      isCodedWorkflowSource(document.getText());
    setKey(isWorkflow);
  };

  evaluate(vscode.window.activeTextEditor?.document);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => evaluate(editor?.document)),
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Only a save of the document the user is looking at can change the key.
      if (vscode.window.activeTextEditor?.document === document) {
        evaluate(document);
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  installReloadWatcher(context);
  installCsWorkflowContextKey(context);

  // Store wasm paths for the C# parser — pure storage, no I/O.  The wasm
  // files are loaded lazily on the first getCSharpParser() call, so
  // activation cost is zero.
  configureCSharpParser({
    runtimeWasmPath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'web-tree-sitter.wasm').fsPath,
    grammarWasmPath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'tree-sitter-c_sharp.wasm').fsPath
  });
  context.subscriptions.push({ dispose: disposeCSharpParser });

  const provider = new ArtifactEditorProvider(context);

  const viewTypes: string[] = [];
  for (const descriptor of Object.values(artifactRegistry)) {
    viewTypes.push(descriptor.viewType);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(descriptor.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      })
    );
  }

  // Drives the `when` clauses of the editor-title / command-palette menus.
  // Pipe failures to the output channel — silent rejection would leave menu
  // items invisible with no diagnostic trail.
  vscode.commands
    .executeCommand('setContext', 'uipathArtifactDesigner.viewTypes', viewTypes)
    .then(undefined, (e: unknown) => logError('setContext failed', e));

  logInfo(`UiPath Artifact Designer activated (${viewTypes.length} designers registered).`);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'uipathArtifactDesigner.openDesigner',
      async (uri?: vscode.Uri) => {
        const target = pickArtifactUri(uri);
        if (!target) {
          void vscode.window.showInformationMessage(
            'UiPath Artifact Designer: open a UiPath artifact first ' +
              '(agent.json, *.flow, *.bpmn, caseplan.json, action-schema.json, ' +
              'or .cs coded workflows).'
          );
          return;
        }
        const descriptor = descriptorForUri(target);
        if (descriptor) {
          await vscode.commands.executeCommand('vscode.openWith', target, descriptor.viewType);
        }
      }
    ),
    vscode.commands.registerCommand(
      'uipathArtifactDesigner.reopenAsText',
      async (uri?: vscode.Uri) => {
        const target = uri ?? provider.getActiveDocumentUri();
        if (!target) {
          return;
        }
        await vscode.commands.executeCommand('vscode.openWith', target, 'default');
      }
    ),
    vscode.commands.registerCommand('uipathArtifactDesigner.fitToView', () => provider.fitActive()),
    vscode.commands.registerCommand('uipathArtifactDesigner.refresh', () => provider.refreshActive()),
    vscode.commands.registerCommand(
      'uipathArtifactDesigner.showCallGraph',
      async (uri?: vscode.Uri) => {
        // Case 1: the active editor is already a coded-workflow designer —
        // just ask its webview to switch views.
        const activeDesignerUri = provider.getActiveDocumentUri();
        if (
          activeDesignerUri &&
          descriptorForUri(activeDesignerUri)?.kind === 'coded-workflow'
        ) {
          provider.showGraphActive();
          return;
        }
        // Case 2: a .cs target (command argument or active text editor)
        // inside a UiPath project — open the designer, then ask for the
        // graph. showGraphFor queues the control until the first model
        // render, so the webview receives it after its renderer mounts.
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (target && target.path.toLowerCase().endsWith('.cs')) {
          const root = await findProjectRoot(target);
          if (root !== undefined) {
            await vscode.commands.executeCommand(
              'vscode.openWith',
              target,
              VIEW_TYPES['coded-workflow']
            );
            provider.showGraphFor(target);
            return;
          }
        }
        void vscode.window.showInformationMessage(
          'UiPath: Show Call Graph needs a coded workflow — open a .cs file ' +
            'inside a UiPath project (a folder with project.json).'
        );
      }
    ),
    // Drop the per-project graph indexes (and their parsed-fact caches) when
    // the extension is deactivated.
    { dispose: () => CodedProjectIndex.disposeAll() }
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
