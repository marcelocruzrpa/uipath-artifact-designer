/**
 * Artifact descriptor for UiPath Maestro Case files (`caseplan.json`).
 *
 * The custom editor is registered for any `caseplan.json` file. The document is
 * the authored case definition JSON; edits write the whole file back through a
 * single `WorkspaceEdit`, exactly as the agent / flow / coded-app descriptors
 * do. Both wrapper shapes (v19 `{ root, nodes, edges }` and v20 `{ id, version,
 * metadata, nodes, edges, layout }`) are supported.
 */
import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult, EditContext } from '../model/artifactDescriptor';
import {
  addEdge,
  addStage,
  deleteEdge,
  deleteStage,
  setConditions,
  setEdgeLabel,
  setSlaRules,
  setStageField,
  setTriggerLabel
} from '../model/case/editCase';
import { parseCase } from '../model/case/parseCase';
import { parseJsonLoose } from '../model/parseAgent';
import type { ArtifactModel, MaestroCaseModel } from '../model/types';
import { isRecord } from '../util/objects';
import { uriBasename } from '../util/fsHelpers';
import type { WebviewToHost } from '../util/messages';
import { applyJsonDocumentEdit } from './jsonEditHarness';

/** True when the parsed JSON looks like a v19 case wrapper. */
function looksLikeCaseV19(json: Record<string, unknown>): boolean {
  return isRecord(json.root) && Array.isArray(json.nodes);
}

/** True when the parsed JSON looks like a v20 case wrapper. */
function looksLikeCaseV20(json: Record<string, unknown>): boolean {
  return (
    typeof json.id === 'string' &&
    json.id.startsWith('case-') &&
    typeof json.version === 'string'
  );
}

function detectCase(document: vscode.TextDocument): DetectResult {
  const parsed = parseJsonLoose(document.getText());
  if (parsed.error) {
    return {
      ok: false,
      fallback: { type: 'fallback', kind: 'parse-error', message: parsed.error }
    };
  }
  const json = parsed.json;
  if (!isRecord(json) || (!looksLikeCaseV19(json) && !looksLikeCaseV20(json))) {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'not-case',
        message:
          'This caseplan.json is missing the structure a UiPath Maestro Case ' +
          'requires — a v19 "root" object with "nodes", or a v20 "id" / "version" header.'
      }
    };
  }
  return { ok: true };
}

async function loadCaseModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const result = parseCase(document.getText());
  const model: MaestroCaseModel = {
    kind: 'maestro-case',
    title: result.model.root.name || uriBasename(document.uri),
    subtitle: 'Maestro Case',
    diagnostics: result.diagnostics,
    schemaVersion: result.model.schemaVersion,
    root: result.model.root,
    trigger: result.model.trigger,
    stages: result.model.stages,
    stickyNotes: result.model.stickyNotes,
    edges: result.model.edges,
    caseExitConditions: result.model.caseExitConditions,
    slaRules: result.model.slaRules
  };
  return model;
}

/** Case edit message types routed to {@link applyCaseEdit}. */
const CASE_EDIT_TYPES = new Set<WebviewToHost['type']>([
  'caseAddStage',
  'caseDeleteStage',
  'caseSetStageField',
  'caseSetTriggerLabel',
  'caseAddEdge',
  'caseDeleteEdge',
  'caseSetEdgeLabel',
  'caseSetConditions',
  'caseSetSlaRules'
]);

/** Applies one Case edit message back to the `caseplan.json` file. */
async function applyCaseEdit(
  message: WebviewToHost,
  document: vscode.TextDocument,
  ctx: EditContext
): Promise<void> {
  if (!CASE_EDIT_TYPES.has(message.type)) {
    return;
  }
  await applyJsonDocumentEdit(
    document,
    ctx,
    'UiPath Designer: cannot edit — caseplan.json has invalid JSON.',
    'case',
    (caseJson) => {
      switch (message.type) {
        case 'caseAddStage':
          addStage(caseJson, {
            kind: message.stageKind,
            label: message.label,
            description: message.description,
            isRequired: message.isRequired
          });
          return true;
        case 'caseDeleteStage':
          return deleteStage(caseJson, message.stageId);
        case 'caseSetStageField':
          return setStageField(caseJson, message.stageId, message.field, message.value);
        case 'caseSetTriggerLabel':
          return setTriggerLabel(caseJson, message.triggerId, message.label);
        case 'caseAddEdge':
          return addEdge(caseJson, message.sourceId, message.targetId, message.label) !== null;
        case 'caseDeleteEdge':
          return deleteEdge(caseJson, message.edgeId);
        case 'caseSetEdgeLabel':
          return setEdgeLabel(caseJson, message.edgeId, message.label);
        case 'caseSetConditions':
          return setConditions(caseJson, message.scope, message.conditions, message.stageId);
        case 'caseSetSlaRules':
          return setSlaRules(caseJson, message.slaRules, message.stageId);
        default:
          return false;
      }
    }
  );
}

export const caseDescriptor: ArtifactDescriptor = {
  kind: 'maestro-case',
  viewType: VIEW_TYPES['maestro-case'],
  watchGlobs: '{bindings_v2.json,project.uiproj}',
  detect: detectCase,
  loadModel: loadCaseModel,
  applyEdit: applyCaseEdit
};
