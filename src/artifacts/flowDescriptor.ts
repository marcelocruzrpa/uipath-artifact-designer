/**
 * Artifact descriptor for UiPath Maestro Flow files (`*.flow`).
 *
 * The custom editor is registered for any `.flow` file. The document is the
 * authored JSON graph; edits write the whole file back through a single
 * `WorkspaceEdit`, exactly as the agent / coded-app descriptors do.
 */
import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult, EditContext } from '../model/artifactDescriptor';
import {
  addEdge,
  removeEdge,
  removeNode,
  setNodeInput,
  setNodeLabel,
  setNodePosition
} from '../model/flow/editFlow';
import { parseFlow } from '../model/flow/parseFlow';
import { parseJsonLoose } from '../model/parseAgent';
import type { ArtifactModel, MaestroFlowModel } from '../model/types';
import { isRecord } from '../util/objects';
import { uriBasename } from '../util/fsHelpers';
import type { WebviewToHost } from '../util/messages';
import { applyJsonDocumentEdit } from './jsonEditHarness';

/** True when the parsed JSON looks like a Maestro Flow document. */
function looksLikeFlow(json: unknown): boolean {
  return (
    isRecord(json) &&
    Array.isArray(json.nodes) &&
    Array.isArray(json.edges) &&
    Array.isArray(json.definitions)
  );
}

function detectFlow(document: vscode.TextDocument): DetectResult {
  const parsed = parseJsonLoose(document.getText());
  if (parsed.error) {
    return {
      ok: false,
      fallback: { type: 'fallback', kind: 'parse-error', message: parsed.error }
    };
  }
  if (!looksLikeFlow(parsed.json)) {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'not-flow',
        message:
          'This .flow file is missing the nodes, edges and definitions arrays ' +
          'a UiPath Maestro Flow requires.'
      }
    };
  }
  return { ok: true };
}

async function loadFlowModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const result = parseFlow(document.getText());
  const model: MaestroFlowModel = {
    kind: 'maestro-flow',
    title: result.name || uriBasename(document.uri),
    subtitle: 'Maestro Flow',
    diagnostics: result.diagnostics,
    flowId: result.id,
    flowName: result.name,
    version: result.version,
    nodes: result.nodes,
    edges: result.edges,
    variables: result.variables,
    hasStoredLayout: result.hasStoredLayout
  };
  return model;
}

/** Applies one Flow edit message back to the `.flow` JSON file. */
async function applyFlowEdit(
  message: WebviewToHost,
  document: vscode.TextDocument,
  ctx: EditContext
): Promise<void> {
  if (
    message.type !== 'flowSetNodeLabel' &&
    message.type !== 'flowSetNodeInput' &&
    message.type !== 'flowMoveNode' &&
    message.type !== 'flowAddEdge' &&
    message.type !== 'flowRemoveEdge' &&
    message.type !== 'flowRemoveNode'
  ) {
    return;
  }
  await applyJsonDocumentEdit(
    document,
    ctx,
    'UiPath Designer: cannot edit — this .flow file has invalid JSON.',
    'flow',
    (flow) => {
      switch (message.type) {
        case 'flowSetNodeLabel':
          return setNodeLabel(flow, message.nodeId, message.label);
        case 'flowSetNodeInput':
          return setNodeInput(flow, message.nodeId, message.key, message.value);
        case 'flowMoveNode':
          return setNodePosition(flow, message.nodeId, message.x, message.y);
        case 'flowAddEdge':
          return addEdge(flow, {
            id: message.id,
            sourceNodeId: message.sourceNodeId,
            sourcePort: message.sourcePort,
            targetNodeId: message.targetNodeId,
            targetPort: message.targetPort
          });
        case 'flowRemoveEdge':
          return removeEdge(flow, message.edgeId);
        case 'flowRemoveNode':
          return removeNode(flow, message.nodeId);
        default:
          return false;
      }
    }
  );
}

export const flowDescriptor: ArtifactDescriptor = {
  kind: 'maestro-flow',
  viewType: VIEW_TYPES['maestro-flow'],
  watchGlobs: '{entry-points.json,bindings_v2.json,project.uiproj,operate.json,package-descriptor.json}',
  detect: detectFlow,
  loadModel: loadFlowModel,
  applyEdit: applyFlowEdit
};
