/**
 * Message contract between the extension host and the webview.
 * Shared by both sides — keep free of vscode / Node / DOM dependencies.
 */
import type { ActionFieldEntry, ActionSchemaSectionName, ArtifactModel } from '../model/types';

export type FallbackKind =
  | 'not-agent'
  | 'artifact'
  | 'parse-error'
  | 'not-coded-app'
  | 'not-flow'
  | 'not-bpmn'
  | 'not-case';

/** A single input/output argument as edited in the webview. */
export interface ArgProperty {
  name: string;
  /** A JSON Schema type, or "file" for a job-attachment ($ref) argument. */
  type: string;
  description: string;
}

/** A primitive value an edit can write into a JSON field. */
export type EditValue = string | number | boolean | null;

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
  | { type: 'model'; model: ArtifactModel }
  | { type: 'fallback'; kind: FallbackKind; message: string }
  | { type: 'error'; message: string }
  | { type: 'control'; action: 'fitToView' | 'refresh' };

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'openResource'; uri: string }
  | { type: 'openParentAgent' }
  | { type: 'reopenAsText' }
  | { type: 'persistViewState'; state: WebviewViewState }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  // --- editing ---
  | { type: 'editAgentField'; path: string[]; value: EditValue }
  | { type: 'editAgentPrompt'; role: 'system' | 'user'; content: string }
  | { type: 'editProject'; field: 'Name' | 'Description'; value: string }
  | { type: 'editResourceField'; uri: string; path: string[]; value: EditValue }
  | {
      type: 'editArguments';
      direction: 'input' | 'output';
      properties: ArgProperty[];
      required: string[];
    }
  // --- coded app ---
  | {
      type: 'setActionSchemaSection';
      section: ActionSchemaSectionName;
      fields: ActionFieldEntry[];
    }
  // --- maestro flow ---
  | { type: 'flowSetNodeLabel'; nodeId: string; label: string }
  | { type: 'flowSetNodeInput'; nodeId: string; key: string; value: string }
  | { type: 'flowMoveNode'; nodeId: string; x: number; y: number }
  | {
      type: 'flowAddEdge';
      id: string;
      sourceNodeId: string;
      sourcePort: string;
      targetNodeId: string;
      targetPort: string;
    }
  | { type: 'flowRemoveEdge'; edgeId: string }
  | { type: 'flowRemoveNode'; nodeId: string }
  // --- maestro bpmn ---
  | { type: 'bpmnSetXml'; xml: string }
  // --- maestro case ---
  | {
      type: 'caseAddStage';
      stageKind: 'stage' | 'exception-stage';
      label: string;
      description: string;
      isRequired: boolean;
    }
  | { type: 'caseDeleteStage'; stageId: string }
  | {
      type: 'caseSetStageField';
      stageId: string;
      field: 'label' | 'description' | 'isRequired';
      value: string | boolean;
    }
  | { type: 'caseSetTriggerLabel'; triggerId: string; label: string }
  | { type: 'caseAddEdge'; sourceId: string; targetId: string; label: string }
  | { type: 'caseDeleteEdge'; edgeId: string }
  | { type: 'caseSetEdgeLabel'; edgeId: string; label: string }
  | {
      /** Whole-collection replace of a condition set. `conditions` is the raw DNF array. */
      type: 'caseSetConditions';
      scope: 'stage-entry' | 'stage-exit' | 'case-exit';
      /** Required for stage-scoped condition sets; omitted for `case-exit`. */
      stageId?: string;
      conditions: unknown[];
    }
  | {
      /** Whole-collection replace of an `slaRules[]` array. */
      type: 'caseSetSlaRules';
      /** Required for a stage SLA; omitted for the case-root SLA. */
      stageId?: string;
      slaRules: unknown[];
    };

/** Persisted (per-document) view state — zoom, pan and selection. */
export interface WebviewViewState {
  zoom: number;
  panX: number;
  panY: number;
  selectedId: string | null;
}
