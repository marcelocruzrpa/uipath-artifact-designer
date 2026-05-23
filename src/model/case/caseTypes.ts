/**
 * Shared data types for the Maestro Case (`caseplan.json`) designer.
 *
 * Imported by BOTH the extension host and the webview — keep free of any
 * `vscode`, Node, or DOM dependency. Pure TypeScript interfaces only.
 *
 * The case definition ships in two wrapper shapes: **v19** (`{ root, nodes,
 * edges }`) and **v20** (`{ id: "case-…", version, name, metadata, nodes,
 * edges, layout }`). The per-node and per-edge internal shapes are identical
 * across versions — only the wrapper differs. {@link parseCase} normalizes both
 * into this model and records which one it saw on {@link CaseModel.schemaVersion}.
 */

/** Which on-disk wrapper shape the document used. */
export type CaseSchemaVersion = 'v19' | 'v20';

/**
 * The four classified node kinds in a case graph, derived from the node `type`
 * string. Drives the stage-card shape, accent color and inspector form.
 */
export type CaseNodeKind = 'trigger' | 'stage' | 'exception-stage' | 'sticky-note';

/** Where a condition collection attaches — selects the editing scope. */
export type CaseConditionScope = 'stage-entry' | 'stage-exit' | 'case-exit';

/** One AND-clause rule inside a DNF condition rule set. */
export interface CaseRule {
  /** Stable rule id (`Rule_` + 6 chars), when present. */
  id?: string;
  /** Rule discriminator, e.g. `case-entered`, `required-tasks-completed`. */
  rule: string;
  /** Stage id referenced by `selected-stage-*` rules. */
  selectedStageId?: string;
  /** Task ids referenced by `selected-tasks-completed` rules. */
  selectedTasksIds?: string[];
  /** Optional `=js:` predicate further gating the rule. */
  conditionExpression?: string;
  /** Lossless carrier for any unmodeled rule fields. */
  raw: Record<string, unknown>;
}

/**
 * A DNF condition — a named rule set attached at a stage-entry, stage-exit or
 * case-exit scope. `rules` is an OR of AND-clauses: `rules[orGroup][andClause]`.
 */
export interface CaseCondition {
  /** Stable condition id (`Condition_` + 6 chars), when present. */
  id?: string;
  /** Human label shown on cards and in the inspector. */
  displayName?: string;
  /** DNF rule set — outer array OR, inner array AND. */
  rules: CaseRule[][];
  /** Stage-entry only — whether the condition interrupts the current stage. */
  isInterrupting?: boolean;
  /** Stage-exit only — `exit-only` | `wait-for-user` | `return-to-origin`. */
  type?: string;
  /** Stage-exit only — target stage id when routing to a specific stage. */
  exitToStageId?: string;
  /** Stage-exit only — whether this exit marks the stage complete. */
  marksStageComplete?: boolean;
  /** Case-exit only — whether this exit marks the whole case complete. */
  marksCaseComplete?: boolean;
  /** Lossless carrier for any unmodeled condition fields. */
  raw: Record<string, unknown>;
}

/** One escalation rule nested inside an {@link SlaRuleEntry}. */
export interface SlaEscalation {
  /** Stable escalation id (`esc_` + 6 chars), when present. */
  id?: string;
  /** Optional human label. */
  displayName?: string;
  /** `at-risk` or `sla-breached`. */
  triggerType: string;
  /** Required when `triggerType === 'at-risk'`; the 1–99 threshold. */
  atRiskPercentage?: number;
  /** Notification recipients (`User` / `UserGroup` scopes). */
  recipients: SlaRecipient[];
  /** Lossless carrier for any unmodeled escalation fields. */
  raw: Record<string, unknown>;
}

/** A notification recipient on an {@link SlaEscalation}. */
export interface SlaRecipient {
  /** `User` or `UserGroup`. */
  scope: string;
  /** The user / group UUID. */
  target: string;
  /** Display string — an email or group name. */
  value: string;
}

/**
 * One SLA rule entry. The trailing `expression: "=js:true"` entry is the
 * default / fallback rule; conditional overrides precede it in priority order.
 */
export interface SlaRuleEntry {
  /** Rule predicate. `=js:true` marks the default rule. */
  expression: string;
  /** SLA duration count (optional — escalation-only rules may omit it). */
  count?: number;
  /** SLA duration unit (`min` | `h` | `d` | `w` | `m`). */
  unit?: string;
  /** Notifications fired at-risk or on breach. */
  escalationRule: SlaEscalation[];
  /** Lossless carrier for any unmodeled SLA-rule fields. */
  raw: Record<string, unknown>;
}

/** The trigger node — the case entry point. Exactly one in single-trigger cases. */
export interface CaseTrigger {
  /** Stable node id (`trigger_` + 6 chars). */
  id: string;
  /** Display label from `data.label`. */
  label: string;
  /** `data.uipath.serviceType` — `None` | `Intsvc.EventTrigger` | `Intsvc.TimerTrigger`. */
  serviceType: string;
  /** Stored canvas position, when present (v19). */
  position: { x: number; y: number } | null;
  /** The raw `data` object, for lossless round-trip. */
  raw: Record<string, unknown>;
}

/** A classified stage (regular or exception) in the case graph. */
export interface CaseStage {
  /** Stable node id (`Stage_` + 6 chars). */
  id: string;
  /** `stage` or `exception-stage`. */
  kind: 'stage' | 'exception-stage';
  /** Display label from `data.label`. */
  label: string;
  /** Stage description from `data.description`. */
  description: string;
  /** Whether the stage must complete before case exit. */
  isRequired: boolean;
  /** 2D task lane array `tasks[lane][index]`, rendered read-only in Phase 3. */
  tasks: CaseTask[][];
  /** Stage-entry DNF conditions. */
  entryConditions: CaseCondition[];
  /** Stage-exit DNF conditions. */
  exitConditions: CaseCondition[];
  /** Conditional + default SLA rules for this stage. */
  slaRules: SlaRuleEntry[];
  /** Stored canvas position, when present (v19). */
  position: { x: number; y: number } | null;
  /** The raw `data` object, for lossless round-trip. */
  raw: Record<string, unknown>;
}

/** A read-only summary of one task inside a stage lane. */
export interface CaseTask {
  /** Task id (`t` + 8 chars). */
  id: string;
  /** Human label, when present. */
  displayName: string;
  /** Task type, e.g. `process`, `action`, `agent`. */
  type: string;
}

/** A free-floating annotation node. Ignored at execution time. */
export interface CaseStickyNote {
  /** Stable node id (`StickyNote_` + 6 chars). */
  id: string;
  /** Display label from `data.label`. */
  label: string;
  /** Note color from `data.color`. */
  color: string;
  /** Note body from `data.content`. */
  content: string;
  /** Stored canvas position, when present (v19). */
  position: { x: number; y: number } | null;
  /** The raw `data` object, for lossless round-trip. */
  raw: Record<string, unknown>;
}

/** A directed connection between two case nodes. */
export interface CaseEdge {
  /** Stable edge id (`edge_` + 6 chars). */
  id: string;
  /** `case-management:TriggerEdge` (Trigger→Stage) or `case-management:Edge` (Stage→Stage). */
  type: string;
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Source handle string — `<id>____source____<dir>`. */
  sourceHandle: string;
  /** Target handle string — `<id>____target____<dir>`. */
  targetHandle: string;
  /** Edge label from `data.label`. */
  label: string;
  /** Lossless carrier for the raw edge object. */
  raw: Record<string, unknown>;
}

/** Case-level metadata, normalized across the v19 / v20 wrappers. */
export interface CaseRootInfo {
  /** Case id — `root` literal (v19) or `case-…` (v20). */
  id: string;
  /** Human-readable case name. */
  name: string;
  /** Case description. */
  description: string;
  /** Runtime case identifier (`metadata.caseIdentifier` / `root.caseIdentifier`). */
  caseIdentifier: string;
  /** How the identifier is resolved — `constant` | `external`. */
  caseIdentifierType: string;
  /** Whether the Case App UI is enabled. */
  caseAppEnabled: boolean;
}

/** The fully parsed, normalized case graph plus its source wrapper version. */
export interface CaseModel {
  /** Which on-disk wrapper shape produced this model. */
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
