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
  | 'not-case'
  | 'not-coded-workflow';

/** A single input/output argument as edited in the webview. */
export interface ArgProperty {
  name: string;
  /** A JSON Schema type, or "file" for a job-attachment ($ref) argument. */
  type: string;
  description: string;
}

/** Webview-side slot reference (mirrors edit/editTypes SlotRef). */
export interface SlotRefMessage {
  containerId: string;
  methodId: string;
  role?: string;
  roleIndex?: number;
}

/** A primitive value an edit can write into a JSON field. */
export type EditValue = string | number | boolean | null;

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
  | { type: 'model'; model: ArtifactModel }
  | { type: 'fallback'; kind: FallbackKind; message: string }
  | { type: 'error'; message: string }
  | { type: 'control'; action: 'fitToView' | 'refresh' | 'showGraph' };

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
  | { type: 'ready' }
  // `preview` absent/true → transient preview tab (single-click peek); `false` →
  // a persistent tab opened in the resource's own designer when one is
  // registered (double-click "open the workflow"). See the host's openResource handler.
  | { type: 'openResource'; uri: string; preview?: boolean }
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
    }
  // --- coded workflow canvas ---
  | {
      type: 'editValue';
      /** The node id of the call whose argument is being edited (e.g. `W#Execute/0`). */
      id: string;
      /** Zero-based index of the argument within the call's argument list. */
      argIndex: number;
      /** The new value, serialised as the exact text the user typed (a JSON literal). */
      newText: string;
    }
  | {
      type: 'editArg';
      /** The activity card whose arguments are edited. */
      id: string;
      op: 'change' | 'add' | 'remove' | 'method';
      /** Required for change/remove. */
      argIndex?: number;
      /** Source text of the new/changed argument (change/add). */
      newText?: string;
      /** New method name (method switch). */
      newMethod?: string;
    }
  | {
      type: 'addStatement';
      slot: SlotRefMessage;
      index: number;
      /**
       * Trusted palette item id (`catalog:<svc>.<m>` | `step:assign` |
       * `step:add-item` | `raw`). The HOST emits the statement source from the
       * matching catalog template — the webview no longer sends final C# — so a
       * crafted message cannot repurpose a catalog insert into arbitrary code.
       */
      paletteItemId: string;
      /** Per-arg values substituted into the item's schema; `[]` for raw. */
      argValues: string[];
      /** Optional result-binding variable name (for `returnsValue` items). */
      resultBinding?: string;
      /** Free-text C# — honored ONLY when `paletteItemId` is the `raw` escape. */
      rawText?: string;
    }
  | { type: 'deleteStatement'; id: string }
  | { type: 'moveStatement'; id: string; direction: 1 | -1 };

/** Convenience alias for the `editValue` member of `WebviewToHost`. */
export type EditValueMessage = Extract<WebviewToHost, { type: 'editValue' }>;

/** Convenience alias for the `editArg` member of `WebviewToHost`. */
export type EditArgMessage = Extract<WebviewToHost, { type: 'editArg' }>;

/** Convenience alias for the `addStatement` member of `WebviewToHost`. */
export type AddStatementMessage = Extract<WebviewToHost, { type: 'addStatement' }>;

/** Convenience alias for the `deleteStatement` member of `WebviewToHost`. */
export type DeleteStatementMessage = Extract<WebviewToHost, { type: 'deleteStatement' }>;

/** Convenience alias for the `moveStatement` member of `WebviewToHost`. */
export type MoveStatementMessage = Extract<WebviewToHost, { type: 'moveStatement' }>;

/** Persisted (per-document) view state — zoom, pan, selection and collapse. */
export interface WebviewViewState {
  zoom: number;
  panX: number;
  panY: number;
  selectedId: string | null;
  /** Ids of collapsed containers (coded-workflow canvas); absent for other kinds. */
  collapsedIds?: string[];
  /** Active coded-workflow view — file canvas or project call graph; absent for other kinds. */
  mode?: 'canvas' | 'graph';
  /** Whether the canvas is in value-editing mode; absent when not editing. */
  editing?: boolean;
}
