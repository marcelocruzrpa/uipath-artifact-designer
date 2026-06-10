import type { ArtifactKind } from './model/artifactKind';

/**
 * Custom-editor view-type ids, one per artifact kind. Each value MUST match a
 * `contributes.customEditors[].viewType` entry in package.json.
 */
export const VIEW_TYPES: Record<ArtifactKind, string> = {
  agent: 'uipathArtifactDesigner.agentEditor',
  'maestro-flow': 'uipathArtifactDesigner.maestroFlowEditor',
  'maestro-bpmn': 'uipathArtifactDesigner.maestroBpmnEditor',
  'maestro-case': 'uipathArtifactDesigner.maestroCaseEditor',
  'coded-app': 'uipathArtifactDesigner.codedAppEditor',
  'coded-workflow': 'uipathArtifactDesigner.codedWorkflowEditor'
};
