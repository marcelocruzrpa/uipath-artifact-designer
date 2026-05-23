/**
 * The artifact-descriptor registry: maps each artifact kind to the descriptor
 * that knows how to detect, load and edit it. Host-side only.
 */
import type * as vscode from 'vscode';
import type { ArtifactKind } from './artifactKind';
import type { ArtifactDescriptor } from './artifactDescriptor';
import { agentDescriptor } from '../artifacts/agentDescriptor';
import { bpmnDescriptor } from '../artifacts/bpmnDescriptor';
import { caseDescriptor } from '../artifacts/caseDescriptor';
import { codedAppDescriptor } from '../artifacts/codedAppDescriptor';
import { flowDescriptor } from '../artifacts/flowDescriptor';
import { uriBasename } from '../util/fsHelpers';

/** Every artifact kind the extension can open, keyed by kind. */
export const artifactRegistry: Record<ArtifactKind, ArtifactDescriptor> = {
  agent: agentDescriptor,
  'maestro-flow': flowDescriptor,
  'maestro-bpmn': bpmnDescriptor,
  'maestro-case': caseDescriptor,
  'coded-app': codedAppDescriptor
};

/** Matches a document URI to its artifact descriptor by file name. */
export function descriptorForUri(uri: vscode.Uri): ArtifactDescriptor | undefined {
  const name = uriBasename(uri).toLowerCase();
  if (name === 'agent.json') {
    return artifactRegistry.agent;
  }
  if (name.endsWith('.flow')) {
    return artifactRegistry['maestro-flow'];
  }
  if (name.endsWith('.bpmn')) {
    return artifactRegistry['maestro-bpmn'];
  }
  if (name === 'caseplan.json') {
    return artifactRegistry['maestro-case'];
  }
  if (name === 'action-schema.json') {
    return artifactRegistry['coded-app'];
  }
  return undefined;
}
