/**
 * Pure parsing for a Maestro Case (`caseplan.json`) document.
 *
 * Normalizes both wrapper shapes — v19 (`{ root, nodes, edges }`) and v20
 * (`{ id, version, name, metadata, nodes, edges, layout }`) — into a single
 * {@link CaseModel}, records which one it saw, and surfaces parse diagnostics
 * (missing trigger, orphan stage, dangling edge). No vscode / Node / DOM
 * dependency — imported by both the host and the webview.
 */
import { parseJsonLoose } from '../parseAgent';
import { isRecord } from '../../util/objects';
import { asNumber, asStringOr } from '../../util/jsonShape';
import type { Diagnostic } from '../types';
import type {
  CaseCondition,
  CaseEdge,
  CaseModel,
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
} from './caseTypes';

/** The parse result — a normalized model plus any diagnostics. */
export interface CaseParseResult {
  model: CaseModel;
  diagnostics: Diagnostic[];
}

/** Reads a `{ x, y }` position object, returning null when absent or malformed. */
function readPosition(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = asNumber(value.x);
  const y = asNumber(value.y);
  return x !== undefined && y !== undefined ? { x, y } : null;
}

/**
 * Detects the wrapper shape. v19 carries a `root` object; v20 carries a
 * top-level `id` starting with `case-` plus a `version`.
 */
export function detectCaseSchema(json: Record<string, unknown>): CaseSchemaVersion {
  if (isRecord(json.root)) {
    return 'v19';
  }
  if (typeof json.id === 'string' && json.id.startsWith('case-')) {
    return 'v20';
  }
  // Fallback: a `metadata` block without `root` reads as v20.
  return isRecord(json.metadata) ? 'v20' : 'v19';
}

/** Parses one DNF rule entry. */
function parseRule(raw: unknown): CaseRule | null {
  if (!isRecord(raw)) {
    return null;
  }
  const rule: CaseRule = {
    rule: asStringOr(raw.rule, 'adhoc'),
    raw
  };
  if (typeof raw.id === 'string') {
    rule.id = raw.id;
  }
  if (typeof raw.selectedStageId === 'string') {
    rule.selectedStageId = raw.selectedStageId;
  }
  if (Array.isArray(raw.selectedTasksIds)) {
    rule.selectedTasksIds = raw.selectedTasksIds.filter((t): t is string => typeof t === 'string');
  }
  if (typeof raw.conditionExpression === 'string') {
    rule.conditionExpression = raw.conditionExpression;
  }
  return rule;
}

/** Parses a DNF rule set — an OR of AND-clauses. */
function parseRules(raw: unknown): CaseRule[][] {
  const groups: CaseRule[][] = [];
  if (!Array.isArray(raw)) {
    return groups;
  }
  for (const group of raw) {
    if (!Array.isArray(group)) {
      continue;
    }
    const clause: CaseRule[] = [];
    for (const ruleRaw of group) {
      const rule = parseRule(ruleRaw);
      if (rule) {
        clause.push(rule);
      }
    }
    groups.push(clause);
  }
  return groups;
}

/** Parses one condition object at any scope. */
function parseCondition(raw: unknown): CaseCondition | null {
  if (!isRecord(raw)) {
    return null;
  }
  const condition: CaseCondition = {
    rules: parseRules(raw.rules),
    raw
  };
  if (typeof raw.id === 'string') {
    condition.id = raw.id;
  }
  if (typeof raw.displayName === 'string') {
    condition.displayName = raw.displayName;
  }
  if (typeof raw.isInterrupting === 'boolean') {
    condition.isInterrupting = raw.isInterrupting;
  }
  if (typeof raw.type === 'string') {
    condition.type = raw.type;
  }
  if (typeof raw.exitToStageId === 'string') {
    condition.exitToStageId = raw.exitToStageId;
  }
  if (typeof raw.marksStageComplete === 'boolean') {
    condition.marksStageComplete = raw.marksStageComplete;
  }
  if (typeof raw.marksCaseComplete === 'boolean') {
    condition.marksCaseComplete = raw.marksCaseComplete;
  }
  return condition;
}

/** Parses an array of condition objects, dropping malformed entries. */
function parseConditions(raw: unknown): CaseCondition[] {
  const conditions: CaseCondition[] = [];
  if (!Array.isArray(raw)) {
    return conditions;
  }
  for (const entry of raw) {
    const condition = parseCondition(entry);
    if (condition) {
      conditions.push(condition);
    }
  }
  return conditions;
}

/** Parses one escalation recipient. */
function parseRecipient(raw: unknown): SlaRecipient | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    scope: asStringOr(raw.scope, 'User'),
    target: asStringOr(raw.target, ''),
    value: asStringOr(raw.value, '')
  };
}

/** Parses one SLA escalation rule. */
function parseEscalation(raw: unknown): SlaEscalation | null {
  if (!isRecord(raw)) {
    return null;
  }
  const trigger = isRecord(raw.triggerInfo) ? raw.triggerInfo : {};
  const action = isRecord(raw.action) ? raw.action : {};
  const recipients: SlaRecipient[] = [];
  if (Array.isArray(action.recipients)) {
    for (const r of action.recipients) {
      const recipient = parseRecipient(r);
      if (recipient) {
        recipients.push(recipient);
      }
    }
  }
  const escalation: SlaEscalation = {
    triggerType: asStringOr(trigger.type, 'sla-breached'),
    recipients,
    raw
  };
  if (typeof raw.id === 'string') {
    escalation.id = raw.id;
  }
  if (typeof raw.displayName === 'string') {
    escalation.displayName = raw.displayName;
  }
  const pct = asNumber(trigger.atRiskPercentage);
  if (pct !== undefined) {
    escalation.atRiskPercentage = pct;
  }
  return escalation;
}

/** Parses one `slaRules[]` entry. */
function parseSlaRule(raw: unknown): SlaRuleEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  const escalations: SlaEscalation[] = [];
  if (Array.isArray(raw.escalationRule)) {
    for (const e of raw.escalationRule) {
      const escalation = parseEscalation(e);
      if (escalation) {
        escalations.push(escalation);
      }
    }
  }
  const entry: SlaRuleEntry = {
    expression: asStringOr(raw.expression, '=js:true'),
    escalationRule: escalations,
    raw
  };
  const count = asNumber(raw.count);
  if (count !== undefined) {
    entry.count = count;
  }
  if (typeof raw.unit === 'string') {
    entry.unit = raw.unit;
  }
  return entry;
}

/** Parses a `slaRules[]` array. */
function parseSlaRules(raw: unknown): SlaRuleEntry[] {
  const rules: SlaRuleEntry[] = [];
  if (!Array.isArray(raw)) {
    return rules;
  }
  for (const entry of raw) {
    const rule = parseSlaRule(entry);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

/** Parses one task envelope from a stage lane. */
function parseTask(raw: unknown): CaseTask | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    displayName: asStringOr(raw.displayName, ''),
    type: asStringOr(raw.type, 'unknown')
  };
}

/** Parses a 2D `tasks` lane array. */
function parseTaskLanes(raw: unknown): CaseTask[][] {
  const lanes: CaseTask[][] = [];
  if (!Array.isArray(raw)) {
    return lanes;
  }
  for (const lane of raw) {
    if (!Array.isArray(lane)) {
      continue;
    }
    const tasks: CaseTask[] = [];
    for (const taskRaw of lane) {
      const task = parseTask(taskRaw);
      if (task) {
        tasks.push(task);
      }
    }
    lanes.push(tasks);
  }
  return lanes;
}

/** Parses a trigger node into a {@link CaseTrigger}. */
function parseTrigger(node: Record<string, unknown>): CaseTrigger {
  const data = isRecord(node.data) ? node.data : {};
  const uipath = isRecord(data.uipath) ? data.uipath : {};
  return {
    id: asStringOr(node.id, ''),
    label: asStringOr(data.label, 'Start'),
    serviceType: asStringOr(uipath.serviceType, 'None'),
    position: readPosition(node.position),
    raw: data
  };
}

/** Parses a stage / exception-stage node into a {@link CaseStage}. */
function parseStage(
  node: Record<string, unknown>,
  kind: 'stage' | 'exception-stage'
): CaseStage {
  const data = isRecord(node.data) ? node.data : {};
  return {
    id: asStringOr(node.id, ''),
    kind,
    label: asStringOr(data.label, asStringOr(node.id, '')),
    description: asStringOr(data.description, ''),
    isRequired: data.isRequired === true,
    tasks: parseTaskLanes(data.tasks),
    entryConditions: parseConditions(data.entryConditions),
    exitConditions: parseConditions(data.exitConditions),
    slaRules: parseSlaRules(data.slaRules),
    position: readPosition(node.position),
    raw: data
  };
}

/** Parses a sticky-note node into a {@link CaseStickyNote}. */
function parseStickyNote(node: Record<string, unknown>): CaseStickyNote {
  const data = isRecord(node.data) ? node.data : {};
  return {
    id: asStringOr(node.id, ''),
    label: asStringOr(data.label, 'Note'),
    color: asStringOr(data.color, 'yellow'),
    content: asStringOr(data.content, ''),
    position: readPosition(node.position),
    raw: data
  };
}

/** Parses one edge object. */
function parseEdge(raw: unknown): CaseEdge | null {
  if (!isRecord(raw) || typeof raw.source !== 'string' || typeof raw.target !== 'string') {
    return null;
  }
  const data = isRecord(raw.data) ? raw.data : {};
  return {
    id: asStringOr(raw.id, '') || `${raw.source}-${raw.target}`,
    type: asStringOr(raw.type, 'case-management:Edge'),
    source: raw.source,
    target: raw.target,
    sourceHandle: asStringOr(raw.sourceHandle, `${raw.source}____source____right`),
    targetHandle: asStringOr(raw.targetHandle, `${raw.target}____target____left`),
    label: asStringOr(data.label, ''),
    raw
  };
}

/**
 * Normalizes case-level metadata across both wrappers. v19 reads from `root`;
 * v20 reads from the top level plus the `metadata` block.
 */
function parseRootInfo(
  json: Record<string, unknown>,
  schemaVersion: CaseSchemaVersion
): CaseRootInfo {
  if (schemaVersion === 'v19') {
    const root = isRecord(json.root) ? json.root : {};
    return {
      id: asStringOr(root.id, 'root'),
      name: asStringOr(root.name, ''),
      description: asStringOr(root.description, ''),
      caseIdentifier: asStringOr(root.caseIdentifier, ''),
      caseIdentifierType: asStringOr(root.caseIdentifierType, 'constant'),
      caseAppEnabled: root.caseAppEnabled === true
    };
  }
  const metadata = isRecord(json.metadata) ? json.metadata : {};
  return {
    id: asStringOr(json.id, 'case-'),
    name: asStringOr(json.name, ''),
    description: asStringOr(json.description, ''),
    caseIdentifier: asStringOr(metadata.caseIdentifier, ''),
    caseIdentifierType: asStringOr(metadata.caseIdentifierType, 'constant'),
    caseAppEnabled: metadata.caseAppEnabled === true
  };
}

/**
 * Resolves root-level `slaRules`. The schema docs place v19 SLA at
 * `root.data.slaRules`, but the CLI also emits a top-level `metadata.slaRules`
 * — both locations are probed so either real-world layout parses.
 */
function parseRootSla(
  json: Record<string, unknown>,
  schemaVersion: CaseSchemaVersion
): SlaRuleEntry[] {
  const metadata = isRecord(json.metadata) ? json.metadata : {};
  if (Array.isArray(metadata.slaRules)) {
    return parseSlaRules(metadata.slaRules);
  }
  if (schemaVersion === 'v19') {
    const root = isRecord(json.root) ? json.root : {};
    const data = isRecord(root.data) ? root.data : {};
    return parseSlaRules(data.slaRules);
  }
  return [];
}

/**
 * Resolves case-exit conditions. v19 names the array `caseExitConditions`
 * (under `root`); v20 renames it `caseExitRules` (under `metadata`). The CLI
 * hybrid can also emit `metadata.caseExitRules` for a v19 wrapper — both keys
 * and both locations are probed.
 */
function parseCaseExit(
  json: Record<string, unknown>,
  schemaVersion: CaseSchemaVersion
): CaseCondition[] {
  const metadata = isRecord(json.metadata) ? json.metadata : {};
  if (Array.isArray(metadata.caseExitRules)) {
    return parseConditions(metadata.caseExitRules);
  }
  if (Array.isArray(metadata.caseExitConditions)) {
    return parseConditions(metadata.caseExitConditions);
  }
  if (schemaVersion === 'v19') {
    const root = isRecord(json.root) ? json.root : {};
    if (Array.isArray(root.caseExitConditions)) {
      return parseConditions(root.caseExitConditions);
    }
  }
  return [];
}

/** Classifies a case node `type` string. */
function classifyNode(type: string): 'trigger' | 'stage' | 'exception-stage' | 'sticky-note' | null {
  switch (type) {
    case 'case-management:Trigger':
      return 'trigger';
    case 'case-management:Stage':
      return 'stage';
    case 'case-management:ExceptionStage':
      return 'exception-stage';
    case 'case-management:StickyNote':
      return 'sticky-note';
    default:
      return null;
  }
}

/** An empty model — returned on a parse error so callers never see `null`. */
function emptyModel(schemaVersion: CaseSchemaVersion): CaseModel {
  return {
    schemaVersion,
    root: {
      id: '',
      name: '',
      description: '',
      caseIdentifier: '',
      caseIdentifierType: 'constant',
      caseAppEnabled: false
    },
    trigger: null,
    stages: [],
    stickyNotes: [],
    edges: [],
    caseExitConditions: [],
    slaRules: []
  };
}

/**
 * Parses a `caseplan.json` document text into a normalized {@link CaseModel}.
 * Never throws — a JSON error is reported through the diagnostics array.
 */
export function parseCase(text: string): CaseParseResult {
  const parsed = parseJsonLoose(text);
  if (parsed.error) {
    return {
      model: emptyModel('v19'),
      diagnostics: [{ severity: 'warning', message: parsed.error }]
    };
  }
  if (!isRecord(parsed.json)) {
    return {
      model: emptyModel('v19'),
      diagnostics: [{ severity: 'warning', message: 'caseplan.json is not a JSON object.' }]
    };
  }

  const json = parsed.json;
  const schemaVersion = detectCaseSchema(json);
  const diagnostics: Diagnostic[] = [];

  let trigger: CaseTrigger | null = null;
  const stages: CaseStage[] = [];
  const stickyNotes: CaseStickyNote[] = [];

  if (Array.isArray(json.nodes)) {
    for (const raw of json.nodes) {
      if (!isRecord(raw) || typeof raw.id !== 'string') {
        continue;
      }
      const kind = classifyNode(asStringOr(raw.type, ''));
      if (kind === 'trigger') {
        if (!trigger) {
          trigger = parseTrigger(raw);
        }
      } else if (kind === 'stage') {
        stages.push(parseStage(raw, 'stage'));
      } else if (kind === 'exception-stage') {
        stages.push(parseStage(raw, 'exception-stage'));
      } else if (kind === 'sticky-note') {
        stickyNotes.push(parseStickyNote(raw));
      }
    }
  }

  const nodeIds = new Set<string>();
  if (trigger) {
    nodeIds.add(trigger.id);
  }
  for (const stage of stages) {
    nodeIds.add(stage.id);
  }
  for (const note of stickyNotes) {
    nodeIds.add(note.id);
  }

  const edges: CaseEdge[] = [];
  if (Array.isArray(json.edges)) {
    for (const raw of json.edges) {
      const edge = parseEdge(raw);
      if (!edge) {
        continue;
      }
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        diagnostics.push({
          severity: 'warning',
          message: `Edge "${edge.id}" references a node that does not exist.`
        });
        continue;
      }
      edges.push(edge);
    }
  }

  // Diagnostics: missing trigger.
  if (!trigger) {
    diagnostics.push({
      severity: 'warning',
      message: 'This case has no trigger node — it has no entry point.'
    });
  }

  // Diagnostics: orphan stages (no incoming edge, ignoring exception stages).
  const targetIds = new Set(edges.map((e) => e.target));
  for (const stage of stages) {
    if (stage.kind === 'stage' && !targetIds.has(stage.id)) {
      diagnostics.push({
        severity: 'info',
        message: `Stage "${stage.label}" has no incoming edge.`
      });
    }
  }

  if (stages.length === 0) {
    diagnostics.push({ severity: 'info', message: 'This case has no stages yet.' });
  }

  const model: CaseModel = {
    schemaVersion,
    root: parseRootInfo(json, schemaVersion),
    trigger,
    stages,
    stickyNotes,
    edges,
    caseExitConditions: parseCaseExit(json, schemaVersion),
    slaRules: parseRootSla(json, schemaVersion)
  };

  return { model, diagnostics };
}
