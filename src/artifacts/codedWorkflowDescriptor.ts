/**
 * Artifact descriptor for UiPath Coded Workflows (`.cs` files that inherit
 * `CodedWorkflow` or carry a `[Workflow]` / `[TestCase]` entry point).
 *
 * PLACEHOLDER: `loadModel` returns an empty-but-valid `CodedWorkflowModel`
 * so the registry compiles and the editor opens end to end. The real
 * tree-sitter parse + tier classification lands in T1.3/T1.4.
 */
import type * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult } from '../model/artifactDescriptor';
import { isCodedWorkflowSource } from '../model/codedWorkflow/detectSource';
import type { ArtifactModel, CodedWorkflowModel } from '../model/types';
import { uriBasename } from '../util/fsHelpers';

function detectCodedWorkflow(document: vscode.TextDocument): DetectResult {
  if (isCodedWorkflowSource(document.getText())) {
    return { ok: true };
  }
  return {
    ok: false,
    fallback: {
      type: 'fallback',
      kind: 'not-coded-workflow',
      message:
        'This C# file does not inherit CodedWorkflow and has no [Workflow] entry point, ' +
        'so there is no canvas for it. Helper classes appear as nodes in the project ' +
        'call graph instead.'
    }
  };
}

async function loadCodedWorkflowModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const fileName = uriBasename(document.uri);
  const model: CodedWorkflowModel = {
    kind: 'coded-workflow',
    title: fileName,
    subtitle: 'Coded Workflow',
    diagnostics: [],
    fileName,
    fileUri: document.uri.toString(),
    classes: [],
    otherClassNames: [],
    parseHealth: 'ok',
    parseErrorCount: 0,
    truncated: false,
    totalLines: 0,
    stats: { totalStatements: 0, tier1: 0, tier2: 0, tier3: 0, parseMs: 0, classifyMs: 0 }
  };
  return model;
}

async function applyCodedWorkflowEdit(): Promise<void> {
  // R9: read-only — the coded-workflow canvas never writes back to the .cs file.
}

export const codedWorkflowDescriptor: ArtifactDescriptor = {
  kind: 'coded-workflow',
  viewType: VIEW_TYPES['coded-workflow'],
  watchGlobs: '**/*.cs',
  detect: detectCodedWorkflow,
  loadModel: loadCodedWorkflowModel,
  applyEdit: applyCodedWorkflowEdit
};
