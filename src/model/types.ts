/**
 * Shared data model for the UiPath Artifact Designer.
 *
 * This file is imported by BOTH the extension host (Node) and the webview (DOM).
 * It must therefore stay free of any `vscode`, Node, or DOM dependency — pure
 * TypeScript interfaces only.
 */

import type { ArtifactKind } from './artifactKind';
import type {
  CaseCondition,
  CaseEdge,
  CaseRootInfo,
  CaseSchemaVersion,
  CaseStage,
  CaseStickyNote,
  CaseTrigger,
  SlaRuleEntry
} from './case/caseTypes';
import type { CodedWorkflowModel } from './codedWorkflow/cwTypes';
import type { FlowEdge, FlowNode, FlowVariable } from './flow/flowTypes';

export type { FlowEdge, FlowNode, FlowNodeKind, FlowPort, FlowVariable } from './flow/flowTypes';
export type {
  CodedWorkflowModel,
  CwActivityCard,
  CwArgSummary,
  CwContainer,
  CwContainerKind,
  CwEntryPoint,
  CwHelperMethod,
  CwPseudoStep,
  CwRawChip,
  CwSlot,
  CwSlotRole,
  CwStatement,
  CwTierCounts,
  CwWorkflowClass,
  SourceSpan
} from './codedWorkflow/cwTypes';
export type {
  CaseCondition,
  CaseConditionScope,
  CaseEdge,
  CaseNodeKind,
  CaseRootInfo,
  CaseRule,
  CaseSchemaVersion,
  CaseStage,
  CaseStickyNote,
  CaseTask,
  CaseTrigger,
  SlaEscalation,
  SlaRecipient,
  SlaRuleEntry
} from './case/caseTypes';

/** A node kind in the rendered graph. Drives the icon, accent color and inspector. */
export type NodeKind =
  | 'tool-process'
  | 'tool-integration'
  | 'tool-builtin'
  | 'tool-unknown'
  | 'context-index'
  | 'context-attachments'
  | 'context-datafabric'
  | 'context-unknown'
  | 'escalation'
  | 'memory'
  | 'unknown';

/** High-level grouping used for deterministic layout ordering. */
export type NodeGroup = 'tool' | 'context' | 'escalation' | 'memory' | 'other';

export type BadgeTone = 'method' | 'location' | 'warn' | 'muted' | 'accent';

export interface Badge {
  label: string;
  tone: BadgeTone;
}

/** A label/value pair shown in the inspector. */
export interface Fact {
  label: string;
  value: string;
}

export interface JsonSchemaProp {
  type?: string;
  title?: string;
  description?: string;
  $ref?: string;
  enum?: unknown[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  definitions?: Record<string, JsonSchemaProp>;
}

export interface ContentToken {
  /** "simpleText" or "variable" (other values render as plain text). */
  type: string;
  rawString: string;
}

export interface AgentMessage {
  role: string;
  content: string;
  contentTokens: ContentToken[];
}

export interface AgentSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  engine?: string;
  maxIterations?: number;
  mode?: string;
}

export interface ToolParameter {
  name: string;
  displayName?: string;
  type?: string;
  required?: boolean;
  value?: string;
  description?: string;
  location?: string;
  variant?: string;
}

export interface EscalationChannel {
  name?: string;
  type?: string;
  appName?: string;
  folderName?: string;
  recipients: string[];
  outcomes: string[];
}

/** A resource node — a tool, context, escalation, or an unrecognized resource. */
export interface ResourceNode {
  /** Stable id, derived from the resource directory name. */
  id: string;
  dirName: string;
  kind: NodeKind;
  group: NodeGroup;
  name: string;
  description?: string;
  enabled: boolean;
  /** Remote connector icon URL (Integration Service tools). */
  iconUrl?: string;
  /** Absolute URI (string) of the resource.json file, for "Open resource.json". */
  sourceUri?: string;
  badges: Badge[];
  facts: Fact[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  parameters?: ToolParameter[];
  channels?: EscalationChannel[];
  /** The raw parsed resource.json, for the inspector's raw view. */
  raw: unknown;
}

export interface GuardrailInfo {
  name: string;
  guardrailType: string;
  summary: string;
  scopes: string[];
  matchNames: string[];
  actionType?: string;
  facts: Fact[];
  raw: unknown;
}

export interface EntryPointInfo {
  type: string;
  filePath: string;
  uniqueId: string;
}

export interface BindingInfo {
  resource: string;
  key: string;
  name?: string;
  connector?: string;
  folderPath?: string;
}

export interface EvaluatorInfo {
  name: string;
  type?: number;
  typeLabel: string;
}

export interface EvalSetInfo {
  name: string;
  testCaseCount: number;
  evaluatorCount: number;
}

export interface EvalsSummary {
  evaluators: EvaluatorInfo[];
  sets: EvalSetInfo[];
}

export interface Diagnostic {
  severity: 'info' | 'warning';
  message: string;
}

/** Fields common to every artifact model the webview shell can render. */
export interface ArtifactModelBase {
  /** Discriminates the model type and selects the webview renderer. */
  kind: ArtifactKind;
  /** Primary title shown in the toolbar (e.g. the project or file name). */
  title: string;
  /** Secondary label shown after the title (e.g. "UiPath Agent"). */
  subtitle: string;
  diagnostics: Diagnostic[];
}

/** The complete normalized agent model posted from the host to the webview. */
export interface AgentModel extends ArtifactModelBase {
  kind: 'agent';
  schemaOk: boolean;
  isArtifactCopy: boolean;
  isInlineInFlow: boolean;
  version?: string;
  projectId?: string;
  projectName: string;
  projectDescription?: string;
  settings: AgentSettings;
  metadata: Record<string, unknown>;
  messages: AgentMessage[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  guardrails: GuardrailInfo[];
  resources: ResourceNode[];
  entryPoints: EntryPointInfo[];
  bindings: BindingInfo[];
  evals: EvalsSummary;
  /** Initial canvas zoom from flow-layout.json, clamped to [0.25, 3]. */
  initialZoom: number;
}

/** The Maestro Flow editor model — a classified `.flow` node graph. */
export interface MaestroFlowModel extends ArtifactModelBase {
  kind: 'maestro-flow';
  /** Flow `id` (a UUID), when present. */
  flowId: string;
  /** Flow `name`, when present. */
  flowName: string;
  /** Workflow file-format version (top-level `version`). */
  version: string;
  /** Classified, layout-resolved nodes. */
  nodes: FlowNode[];
  /** Directed connections between node ports. */
  edges: FlowEdge[];
  /** Workflow-level variables (`variables.globals`). */
  variables: FlowVariable[];
  /** True when at least one node carried a stored `layout.nodes` position. */
  hasStoredLayout: boolean;
}

/**
 * The Maestro BPMN editor model — the raw `.bpmn` XML document plus a few
 * shallow-scan facts. The webview's embedded `bpmn-js` modeler owns the
 * authoritative parse; this model only carries the document text through and
 * supplies the title / element count for the shell and diagnostics.
 */
export interface MaestroBpmnModel extends ArtifactModelBase {
  kind: 'maestro-bpmn';
  /** The raw `.bpmn` document text, passed straight through to `bpmn-js`. */
  xml: string;
  /** The `bpmn:process` `name` attribute, when present. */
  processName?: string;
  /** Count of BPMN flow elements found by the shallow scan (0 if none). */
  elementCount: number;
}

/** The Maestro Case editor model — a normalized `caseplan.json` stage graph. */
export interface MaestroCaseModel extends ArtifactModelBase {
  kind: 'maestro-case';
  /** Which on-disk wrapper shape produced this model (`v19` / `v20`). */
  schemaVersion: CaseSchemaVersion;
  /** Normalized case-level metadata. */
  root: CaseRootInfo;
  /** The single entry-point trigger, when present. */
  trigger: CaseTrigger | null;
  /** Classified regular + exception stages. */
  stages: CaseStage[];
  /** Free-floating annotation nodes. */
  stickyNotes: CaseStickyNote[];
  /** Directed connections between nodes. */
  edges: CaseEdge[];
  /** Case-level exit conditions. */
  caseExitConditions: CaseCondition[];
  /** Case-level (root) SLA rules. */
  slaRules: SlaRuleEntry[];
}

/** One field in an `action-schema.json` section. `required` is inline per-field. */
export interface ActionField {
  type: string;
  required?: boolean;
  description?: string;
  /** Element type for `array` fields. */
  items?: { type: string };
  /** Nested shape for `object` fields — preserved verbatim, not edited in v1. */
  properties?: Record<string, unknown>;
}

/** A named field within an action-schema section; the array preserves order. */
export interface ActionFieldEntry {
  name: string;
  field: ActionField;
}

/** The four sections of an `action-schema.json` data contract. */
export type ActionSchemaSectionName = 'inputs' | 'outputs' | 'inOuts' | 'outcomes';

/** The Coded App editor model: the action-schema contract plus app.config status. */
export interface CodedAppModel extends ArtifactModelBase {
  kind: 'coded-app';
  schemaOk: boolean;
  /** Read-only deployment metadata from `.uipath/app.config.json`. Empty if absent. */
  config: Fact[];
  hasConfig: boolean;
  /** The four action-schema sections, each an ordered list of field entries. */
  actionSchema: Record<ActionSchemaSectionName, ActionFieldEntry[]>;
}

/** Discriminated union of every artifact model the designer can render. */
export type ArtifactModel =
  | AgentModel
  | MaestroFlowModel
  | MaestroBpmnModel
  | MaestroCaseModel
  | CodedAppModel
  | CodedWorkflowModel;
