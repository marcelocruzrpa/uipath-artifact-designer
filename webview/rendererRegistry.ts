/**
 * Maps each artifact kind to the webview renderer factory that handles it.
 * The shell looks up `model.kind` here to mount the right renderer.
 */
import type { ArtifactKind } from '../src/model/artifactKind';
import type { RendererFactory } from './renderer';
import { createAgentRenderer } from './renderers/agentRenderer';
import { createBpmnRenderer } from './renderers/bpmnRenderer';
import { createCaseRenderer } from './renderers/caseRenderer';
import { createCodedAppRenderer } from './renderers/codedAppRenderer';
import { createCodedWorkflowRenderer } from './renderers/codedWorkflowRenderer';
import { createFlowRenderer } from './renderers/flowRenderer';

export const rendererRegistry: Record<ArtifactKind, RendererFactory> = {
  agent: createAgentRenderer,
  'maestro-flow': createFlowRenderer,
  'maestro-bpmn': createBpmnRenderer,
  'maestro-case': createCaseRenderer,
  'coded-app': createCodedAppRenderer,
  'coded-workflow': createCodedWorkflowRenderer
};
