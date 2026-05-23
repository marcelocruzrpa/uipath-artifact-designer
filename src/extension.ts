import * as vscode from 'vscode';
import { ArtifactEditorProvider } from './artifactEditorProvider';
import { artifactRegistry, descriptorForUri } from './model/registry';
import { initLog, logError, logInfo } from './util/log';

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

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
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
              '(agent.json, *.flow, *.bpmn, caseplan.json, or action-schema.json).'
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
    vscode.commands.registerCommand('uipathArtifactDesigner.refresh', () => provider.refreshActive())
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
