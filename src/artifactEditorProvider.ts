import * as vscode from 'vscode';
import { VIEW_TYPES } from './constants';
import type { ArtifactDescriptor, EditContext, FileEdit } from './model/artifactDescriptor';
import { descriptorForUri } from './model/registry';
import { parseJsonLoose } from './model/parseAgent';
import { isInside, uriBasename, uriDirname } from './util/fsHelpers';
import type { HostToWebview, WebviewToHost } from './util/messages';
import { getNonce } from './util/nonce';
import { validateWebviewMessage } from './util/validateMessage';
import { logError, logWarn } from './util/log';
import {
  computeAddStatement,
  computeArgEdit,
  computeDeleteStatement,
  computeMoveStatement,
  computeValueEdit,
  type ComputedEdit
} from './artifacts/codedWorkflowEdit';

/**
 * A single, registry-driven CustomTextEditorProvider that renders any
 * supported UiPath artifact as a webview and applies edits from that webview
 * back to disk through WorkspaceEdit — so VS Code owns the TextDocument and
 * dirty state, save and undo all work. One instance is registered for every
 * artifact view type; the descriptor for a document is resolved from its name.
 */
export class ArtifactEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly updaters = new Map<string, () => Promise<void>>();
  /**
   * Text the extension last wrote per document URI. Used to recognize — and
   * skip — the `onDidChangeTextDocument` event that the extension's own
   * `WorkspaceEdit` triggers, so a self-edit does not cause a second render.
   */
  private readonly lastWrittenText = new Map<string, string>();
  /**
   * Key of the panel that currently has focus. Tracked via
   * `onDidChangeViewState` so command handlers can look up the active
   * document in O(1) instead of scanning {@link panels}.
   */
  private activePanelKey: string | undefined;
  /** Keys of panels that have received at least one `model` message. */
  private readonly renderedKeys = new Set<string>();
  /**
   * Control messages queued for panels that have not rendered a model yet.
   * `showCallGraph` on a not-yet-open document does `vscode.openWith` and then
   * queues the control here; {@link resolveCustomTextEditor}'s render flushes
   * the queue right after posting the model, so the webview receives the
   * control strictly after the model that mounts its renderer (postMessage
   * order is preserved). Entries for documents that never render a model
   * (fallback / error) are discarded on panel dispose.
   */
  private readonly pendingControls = new Map<string, HostToWebview[]>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Host capabilities passed to descriptors when they apply edits. */
  private readonly editContext: EditContext = {
    applyFileEdits: (document, edits) => this.applyFileEdits(document, edits),
    readJsonDoc: (uri) => this.readJsonDoc(uri)
  };

  /**
   * Single source of truth for keying maps by document URI. Centralizing it
   * here lets a future Windows case-insensitivity tweak (or scheme-aware
   * normalization) be a one-line change instead of touching every callsite.
   */
  private documentKey(uri: vscode.Uri): string {
    return uri.toString();
  }

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const descriptor = descriptorForUri(document.uri);
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
    };
    webview.html = this.getHtml(webview);

    const key = this.documentKey(document.uri);
    this.panels.set(key, webviewPanel);

    let firstRenderDone = false;
    /**
     * Set once `onDidDispose` fires. Every async continuation that posts to the
     * webview or applies a WorkspaceEdit must short-circuit on this flag — the
     * panel and its `webview` are gone, and writing to a disposed panel is a
     * silent no-op that masks the wasted work.
     */
    let disposed = false;
    /**
     * File-watcher events are atomic — debounce just enough to coalesce a
     * burst when several sibling files change at once.
     */
    let watcherDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Text-document events fire on every keystroke when a sibling is edited as
     * text. Use a longer debounce so we are not rebuilding the model mid-word.
     */
    let textDocDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    const post = (message: HostToWebview): void => {
      if (disposed) {
        return;
      }
      void webview.postMessage(message);
    };

    const render = async (): Promise<void> => {
      if (disposed) {
        return;
      }
      try {
        if (!descriptor) {
          post({
            type: 'error',
            message: `UiPath Designer: unrecognized artifact file "${uriBasename(document.uri)}".`
          });
          return;
        }
        const detection = descriptor.detect(document);
        if (!detection.ok) {
          const fallback = detection.fallback;
          if (fallback.kind === 'parse-error') {
            if (firstRenderDone) {
              post({
                type: 'error',
                message: `${uriBasename(document.uri)} has invalid JSON: ${fallback.message}`
              });
            } else {
              post(fallback);
            }
          } else {
            post(fallback);
            firstRenderDone = true;
          }
          return;
        }
        const model = await descriptor.loadModel(document);
        post({ type: 'model', model });
        firstRenderDone = true;
        this.renderedKeys.add(key);
        const pending = this.pendingControls.get(key);
        if (pending) {
          this.pendingControls.delete(key);
          for (const queued of pending) {
            post(queued);
          }
        }
      } catch (e) {
        post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    };

    /**
     * Schedule a render in response to an atomic file-watcher event
     * (a sibling resource file changed on disk). 200 ms is enough to
     * coalesce a burst from a multi-file save.
     */
    const scheduleWatcherRender = (): void => {
      if (watcherDebounceTimer) {
        clearTimeout(watcherDebounceTimer);
      }
      watcherDebounceTimer = setTimeout(() => void render(), 200);
    };

    /**
     * Schedule a render in response to an inline text-document edit (the user
     * is typing in the file as plain text in another tab). 400 ms keeps the
     * model from rebuilding mid-keystroke.
     */
    const scheduleTextDocRender = (): void => {
      if (textDocDebounceTimer) {
        clearTimeout(textDocDebounceTimer);
      }
      textDocDebounceTimer = setTimeout(() => void render(), 400);
    };

    this.updaters.set(key, render);

    const subscriptions: vscode.Disposable[] = [];

    subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.documentKey(e.document.uri) !== key) {
          return;
        }
        // Skip the render our own WorkspaceEdit triggers — handleMessage already
        // re-renders synchronously after applying an edit, and the echoed model
        // would otherwise clobber in-progress webview UI state. Only genuinely
        // external changes (file edited as text, or by another tool) re-render.
        if (e.document.getText() === this.lastWrittenText.get(key)) {
          return;
        }
        scheduleTextDocRender();
      })
    );

    subscriptions.push(
      webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          this.activePanelKey = key;
        } else if (this.activePanelKey === key) {
          this.activePanelKey = undefined;
        }
      })
    );

    if (descriptor) {
      const attachWatcher = (base: vscode.Uri): void => {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(base, descriptor.watchGlobs)
        );
        watcher.onDidChange(scheduleWatcherRender);
        watcher.onDidCreate(scheduleWatcherRender);
        watcher.onDidDelete(scheduleWatcherRender);
        subscriptions.push(watcher);
      };
      if (descriptor.watchBase === undefined) {
        // No hook — keep the original, fully synchronous path so descriptors
        // without watchBase behave exactly as before.
        attachWatcher(uriDirname(document.uri));
      } else {
        // watchBase may be async (e.g. walking up to a project root). Attach
        // once it resolves; if the panel was disposed meanwhile, attaching
        // would leak the watcher (the dispose loop already ran), so skip.
        void Promise.resolve(descriptor.watchBase(document))
          .catch((e: unknown) => {
            logWarn(
              `watchBase failed; falling back to the document directory: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
            return undefined;
          })
          .then((base) => {
            if (!disposed) {
              attachWatcher(base ?? uriDirname(document.uri));
            }
          });
      }
    }

    // Messages are processed strictly in order through a per-document queue.
    // Each edit re-serializes the whole file, so two handlers running
    // concurrently would both read the same stale document text and the later
    // WorkspaceEdit would silently erase the earlier one (data loss). Chaining
    // onto a promise guarantees handler N+1 only starts once handler N — and
    // its WorkspaceEdit — has fully settled, so every edit sees fresh text.
    let editQueue: Promise<void> = Promise.resolve();
    subscriptions.push(
      webview.onDidReceiveMessage((raw: unknown) => {
        // The webview can post anything; WebviewToHost is only a compile-time
        // contract. Decode and reject malformed input before it reaches a
        // handler that writes JSON paths or XML to disk.
        const message = validateWebviewMessage(raw);
        if (!message) {
          logWarn('dropped a malformed message received from the webview');
          return;
        }
        editQueue = editQueue.then(async () => {
          // Short-circuit if the panel was closed while we were queued —
          // the document URI may now be unrelated and writing to a disposed
          // webview is wasted work.
          if (disposed) {
            return;
          }
          try {
            await this.handleMessage(message, document, descriptor, render);
          } catch (e) {
            if (disposed) {
              return;
            }
            // Surface the failure to the user (output channel + webview banner)
            // and force a re-render so the inspector resyncs to disk — without
            // this, the user sees their typed value while disk is unchanged
            // (silent data loss).
            logError('message handler failed', e);
            post({
              type: 'error',
              message: `UiPath Designer: edit failed — ${e instanceof Error ? e.message : String(e)}`
            });
            await render();
          }
        });
      })
    );

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (watcherDebounceTimer) {
        clearTimeout(watcherDebounceTimer);
      }
      if (textDocDebounceTimer) {
        clearTimeout(textDocDebounceTimer);
      }
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      this.panels.delete(key);
      this.updaters.delete(key);
      this.lastWrittenText.delete(key);
      this.renderedKeys.delete(key);
      this.pendingControls.delete(key);
      if (this.activePanelKey === key) {
        this.activePanelKey = undefined;
      }
    });
  }

  private async handleMessage(
    message: WebviewToHost,
    document: vscode.TextDocument,
    descriptor: ArtifactDescriptor | undefined,
    render: () => Promise<void>
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        await render();
        break;
      case 'openResource': {
        try {
          // Strict parse: reject a schemeless URI instead of defaulting to file:.
          const target = vscode.Uri.parse(message.uri, true);
          // The guard root defaults to the document's directory; a descriptor
          // can widen it (e.g. to the project root) via resourceRoot. The
          // isInside containment check itself is unchanged.
          let root: vscode.Uri | undefined;
          try {
            root = await descriptor?.resourceRoot?.(document);
          } catch {
            root = undefined;
          }
          if (
            target.scheme !== document.uri.scheme ||
            !isInside(root ?? uriDirname(document.uri), target)
          ) {
            void vscode.window.showWarningMessage(
              'UiPath Designer: refused to open a file outside the project.'
            );
            return;
          }
          await vscode.window.showTextDocument(target, { preview: true });
        } catch (e) {
          logWarn(
            `rejected malformed openResource URI "${message.uri}": ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
        break;
      }
      case 'openParentAgent': {
        const parent = vscode.Uri.joinPath(document.uri, '..', '..', 'agent.json');
        await vscode.commands.executeCommand('vscode.openWith', parent, VIEW_TYPES.agent);
        break;
      }
      case 'reopenAsText':
        await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
        break;
      case 'persistViewState':
      case 'log':
        break;
      case 'editValue':
        // Coded-workflow value edit. The model build + resolve + parse-gate
        // live in a vscode-free helper so they stay unit-testable; here we
        // only translate the result into a range WorkspaceEdit.
        await this.applyComputedEdit(document, await computeValueEdit(document.getText(), message));
        break;
      case 'editArg':
        // Coded-workflow structural arg edit (add/remove/change/method switch);
        // same vscode-free helper path as editValue.
        await this.applyComputedEdit(document, await computeArgEdit(document.getText(), message));
        break;
      case 'addStatement':
        await this.applyComputedEdit(document, await computeAddStatement(document.getText(), message));
        break;
      case 'deleteStatement':
        await this.applyComputedEdit(document, await computeDeleteStatement(document.getText(), message));
        break;
      case 'moveStatement':
        await this.applyComputedEdit(document, await computeMoveStatement(document.getText(), message));
        break;
      default:
        if (descriptor) {
          await descriptor.applyEdit(message, document, this.editContext);
          await render();
        }
        break;
    }
  }

  /**
   * Applies a {@link ComputedEdit} from one of the coded-workflow `compute*`
   * helpers: surface a rejection, otherwise prime the echo-guard with the FULL
   * resulting text BEFORE applying the range edit (so after the edit
   * `document.getText() === computed.after` and the `onDidChangeTextDocument`
   * listener's `=== lastWrittenText.get(key)` check skips the self-triggered
   * re-render; native undo reverts in one step). Shared by editValue / editArg /
   * addStatement / deleteStatement / moveStatement so all four take one path.
   */
  private async applyComputedEdit(
    document: vscode.TextDocument,
    computed: ComputedEdit
  ): Promise<void> {
    if (!computed.ok) {
      void vscode.window.showWarningMessage(`Edit rejected: ${computed.error}`);
      return;
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
  }

  /** Reads and parses a JSON file via the document model (dirty-aware). */
  private async readJsonDoc(uri: vscode.Uri): Promise<Record<string, unknown> | undefined> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const parsed = parseJsonLoose(doc.getText());
      if (parsed.error || !parsed.json || typeof parsed.json !== 'object') {
        return undefined;
      }
      return parsed.json as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  /** Applies whole-file replacements through a single WorkspaceEdit. */
  private async applyFileEdits(document: vscode.TextDocument, edits: FileEdit[]): Promise<void> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      const doc =
        this.documentKey(edit.uri) === this.documentKey(document.uri)
          ? document
          : await vscode.workspace.openTextDocument(edit.uri);
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        doc.positionAt(doc.getText().length)
      );
      workspaceEdit.replace(edit.uri, fullRange, edit.text);
    }
    // Record the text we are about to write BEFORE applyEdit: the
    // onDidChangeTextDocument event fires synchronously inside applyEdit, and
    // its listener compares against this map to skip self-triggered renders.
    for (const edit of edits) {
      this.lastWrittenText.set(this.documentKey(edit.uri), edit.text);
    }
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      // The edit was rejected (e.g. the file changed on disk underneath us).
      // handleMessage re-renders after every edit, so the webview resyncs to
      // the document's actual current content; we just surface the failure.
      void vscode.window.showWarningMessage(
        'UiPath Designer: could not apply your change — the file may have been ' +
          'modified outside the designer. The view has been refreshed.'
      );
    }
  }

  /** URI of the document shown in the currently active designer, if any. */
  public getActiveDocumentUri(): vscode.Uri | undefined {
    return this.activePanelKey ? vscode.Uri.parse(this.activePanelKey) : undefined;
  }

  /** Re-reads the active artifact from disk and re-renders it. */
  public refreshActive(): void {
    if (this.activePanelKey === undefined) {
      return;
    }
    void this.updaters.get(this.activePanelKey)?.();
  }

  /** Asks the active designer webview to fit its graph to the viewport. */
  public fitActive(): void {
    if (this.activePanelKey === undefined) {
      return;
    }
    const panel = this.panels.get(this.activePanelKey);
    if (panel) {
      void panel.webview.postMessage({ type: 'control', action: 'fitToView' } as HostToWebview);
    }
  }

  /** Asks the active designer webview to switch to the call-graph view. */
  public showGraphActive(): void {
    if (this.activePanelKey === undefined) {
      return;
    }
    this.showGraphFor(vscode.Uri.parse(this.activePanelKey));
  }

  /**
   * Asks the designer panel for `uri` to switch to the call-graph view.
   * Posts immediately when the panel has already rendered a model; otherwise
   * queues the control to be flushed right after the first model post, so a
   * freshly `vscode.openWith`-opened panel receives it once its renderer is
   * mounted (see {@link pendingControls}).
   */
  public showGraphFor(uri: vscode.Uri): void {
    const key = this.documentKey(uri);
    const message: HostToWebview = { type: 'control', action: 'showGraph' };
    const panel = this.panels.get(key);
    if (panel === undefined) {
      // No panel for this document (open failed or it was closed) — dropping
      // beats queueing into a map entry that nothing would ever clean up.
      return;
    }
    if (this.renderedKeys.has(key)) {
      void panel.webview.postMessage(message);
      return;
    }
    const pending = this.pendingControls.get(key);
    if (pending) {
      pending.push(message);
    } else {
      this.pendingControls.set(key, [message]);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );
    const csp = [
      `default-src 'none'`,
      `base-uri 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource} data:`,
      `connect-src 'none'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link nonce="${nonce}" rel="stylesheet" href="${styleUri}" />
  <title>UiPath Designer</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
