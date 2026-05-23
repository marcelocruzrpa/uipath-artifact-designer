/**
 * Artifact descriptor for UiPath Maestro BPMN files (`*.bpmn`).
 *
 * The custom editor is registered for any `.bpmn` file. The document is BPMN
 * 2.0 XML (not JSON); the webview embeds the `bpmn-js` modeler, which owns the
 * authoritative parse. Edits replace the whole file with the XML that
 * `bpmn-js` serializes, exactly as the agent / flow / case / coded-app
 * descriptors write their whole files back through a single `WorkspaceEdit`.
 */
import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult, EditContext } from '../model/artifactDescriptor';
import { scanBpmn, validateBpmnXml } from '../model/bpmn/parseBpmn';
import type { ArtifactModel, MaestroBpmnModel } from '../model/types';
import { uriBasename } from '../util/fsHelpers';
import type { WebviewToHost } from '../util/messages';
import { logError } from '../util/log';

/**
 * Cheap content gate. BPMN is XML, not JSON, so there is no `parse-error`
 * path — a file that is not recognizable BPMN gets the `not-bpmn` fallback.
 */
function detectBpmn(document: vscode.TextDocument): DetectResult {
  const scan = scanBpmn(document.getText());
  if (!scan.isBpmn) {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'not-bpmn',
        message:
          scan.reason ??
          'This .bpmn file is not recognizable BPMN 2.0 XML — a UiPath Maestro ' +
            'BPMN process requires a <bpmn:definitions> root with a <bpmn:process>.'
      }
    };
  }
  return { ok: true };
}

/** Parses the `.bpmn` document into the normalized {@link MaestroBpmnModel}. */
async function loadBpmnModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const xml = document.getText();
  const scan = scanBpmn(xml);
  const model: MaestroBpmnModel = {
    kind: 'maestro-bpmn',
    title: scan.processName || uriBasename(document.uri),
    subtitle: 'Maestro BPMN',
    diagnostics: scan.diagnostics,
    xml,
    processName: scan.processName,
    elementCount: scan.elementCount
  };
  return model;
}

/** Applies one BPMN edit message back to the `.bpmn` file. */
async function applyBpmnEdit(
  message: WebviewToHost,
  document: vscode.TextDocument,
  ctx: EditContext
): Promise<void> {
  if (message.type !== 'bpmnSetXml') {
    return;
  }
  try {
    const next = message.xml;
    // Validate well-formedness before writing — bpmn-js can hand back an empty
    // or truncated document, and a corrupt write to disk is unrecoverable.
    const validation = validateBpmnXml(next);
    if (!validation.ok) {
      void vscode.window.showWarningMessage(
        `UiPath Designer: ignored an invalid BPMN export — ${validation.reason}. ` +
          'The file was left unchanged.'
      );
      return;
    }
    // No-op when the serialized XML is byte-identical to disk.
    if (next === document.getText()) {
      return;
    }
    await ctx.applyFileEdits(document, [{ uri: document.uri, text: next }]);
  } catch (e) {
    logError('bpmn edit failed', e);
    void vscode.window.showErrorMessage(
      `UiPath Designer: edit failed — ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export const bpmnDescriptor: ArtifactDescriptor = {
  kind: 'maestro-bpmn',
  viewType: VIEW_TYPES['maestro-bpmn'],
  watchGlobs: '{entry-points.json,bindings_v2.json,project.uiproj,operate.json,package-descriptor.json}',
  detect: detectBpmn,
  loadModel: loadBpmnModel,
  applyEdit: applyBpmnEdit
};
