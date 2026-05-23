/**
 * Pure mutators for a Maestro Case (`caseplan.json`) JSON document.
 *
 * Each function takes the parsed case JSON object and mutates it in place,
 * mirroring the `editFlow.ts` / `editAgent.ts` style. The two wrapper shapes
 * (v19 `{ root, ... }` and v20 `{ id, metadata, ... }`) only differ at the
 * wrapper level — every mutator branches on a detected {@link CaseSchemaVersion}
 * solely to pick a root-level destination, then writes node/edge internals that
 * are identical across versions. No vscode / Node / DOM dependency — these run
 * host-side inside `caseDescriptor.applyEdit`, before re-serialization with
 * {@link serializeJson}.
 */
import { serializeJson } from '../editAgent';
import type { CaseSchemaVersion } from './caseTypes';
import { detectCaseSchema } from './parseCase';
import { isRecord } from '../../util/objects';

export { serializeJson };

// --- id generation --------------------------------------------------------

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a prefixed id in the CLI's `prefixedId(prefix, count)` scheme — a
 * fixed prefix followed by `count` random `[A-Za-z0-9]` characters.
 *
 * Uses `globalThis.crypto.getRandomValues` (CSPRNG, available in Node 18+ and
 * every modern browser) for consistency with the security-conscious nonce
 * generation elsewhere. Modulo bias against 62 is acceptable: these ids are
 * not a security boundary — only collision-resistance and entropy parity matter.
 */
export function prefixedId(prefix: string, count: number): string {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < count; i++) {
    suffix += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return prefix + suffix;
}

// --- structural accessors -------------------------------------------------

/** Returns the `nodes[]` array, creating it when absent. Mutates `caseJson`. */
function nodesArray(caseJson: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(caseJson.nodes)) {
    caseJson.nodes = [];
  }
  return caseJson.nodes as Record<string, unknown>[];
}

/** Returns the `edges[]` array, creating it when absent. Mutates `caseJson`. */
function edgesArray(caseJson: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(caseJson.edges)) {
    caseJson.edges = [];
  }
  return caseJson.edges as Record<string, unknown>[];
}

/** Finds a node object by id within `nodes[]`. */
function findNode(
  caseJson: Record<string, unknown>,
  nodeId: string
): Record<string, unknown> | undefined {
  return nodesArray(caseJson).find((n) => isRecord(n) && n.id === nodeId);
}

/** Returns a node's `data` object, creating it when absent. Mutates the node. */
function nodeData(node: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(node.data)) {
    node.data = {};
  }
  return node.data as Record<string, unknown>;
}

/** True when a node is a regular or exception stage. */
function isStageNode(node: unknown): node is Record<string, unknown> {
  return (
    isRecord(node) &&
    (node.type === 'case-management:Stage' || node.type === 'case-management:ExceptionStage')
  );
}

/**
 * Returns the root metadata container for case-level writes. v19 writes into
 * `root.data`; v20 writes into the top-level `metadata` block. Both are created
 * when absent.
 */
function rootContainer(
  caseJson: Record<string, unknown>,
  schemaVersion: CaseSchemaVersion
): Record<string, unknown> {
  if (schemaVersion === 'v19') {
    if (!isRecord(caseJson.root)) {
      caseJson.root = {};
    }
    const root = caseJson.root as Record<string, unknown>;
    if (!isRecord(root.data)) {
      root.data = {};
    }
    return root.data as Record<string, unknown>;
  }
  if (!isRecord(caseJson.metadata)) {
    caseJson.metadata = {};
  }
  return caseJson.metadata as Record<string, unknown>;
}

// --- stages ---------------------------------------------------------------

/** A new-stage spec accepted by {@link addStage}. */
export interface NewStageSpec {
  kind: 'stage' | 'exception-stage';
  label: string;
  description?: string;
  isRequired?: boolean;
}

/**
 * Appends a new stage node to `nodes[]`. v19 includes the render fields
 * (`position`, `style`, `measured`, `width`, `zIndex`) with a stateful
 * `position.x`; v20 omits all layout fields. Exception stages initialize
 * empty `entryConditions` / `exitConditions`. Mutates `caseJson`. Returns the
 * new stage id.
 */
export function addStage(caseJson: Record<string, unknown>, spec: NewStageSpec): string {
  const schemaVersion = detectCaseSchema(caseJson);
  const nodes = nodesArray(caseJson);
  const stageId = prefixedId('Stage_', 6);
  const type =
    spec.kind === 'exception-stage'
      ? 'case-management:ExceptionStage'
      : 'case-management:Stage';

  const data: Record<string, unknown> = {
    label: spec.label,
    description: spec.description ?? '',
    isRequired: spec.isRequired === true,
    parentElement: { id: 'root', type: 'case-management:root' },
    isInvalidDropTarget: false,
    isPendingParent: false,
    tasks: []
  };
  if (spec.kind === 'exception-stage') {
    data.entryConditions = [];
    data.exitConditions = [];
  }

  const node: Record<string, unknown> = { id: stageId, type, data };
  if (schemaVersion === 'v19') {
    const existingStages = nodes.filter(isStageNode).length;
    node.position = { x: 100 + existingStages * 500, y: 200 };
    node.style = { width: 304, opacity: 0.8 };
    node.measured = { width: 304, height: 128 };
    node.width = 304;
    node.zIndex = 1001;
  }
  nodes.push(node);
  return stageId;
}

/**
 * Removes a stage node and cascades: drops every edge whose `source` or
 * `target` is the stage. Mutates `caseJson`. Returns true on success.
 */
export function deleteStage(caseJson: Record<string, unknown>, stageId: string): boolean {
  const nodes = nodesArray(caseJson);
  const index = nodes.findIndex((n) => isRecord(n) && n.id === stageId);
  if (index < 0) {
    return false;
  }
  nodes.splice(index, 1);

  const edges = edgesArray(caseJson);
  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];
    if (isRecord(edge) && (edge.source === stageId || edge.target === stageId)) {
      edges.splice(i, 1);
    }
  }
  return true;
}

/** A settable scalar field on a stage's `data`. */
export type StageField = 'label' | 'description' | 'isRequired';

/**
 * Sets one scalar field on a stage's `data`. Mutates `caseJson`. Returns true
 * on success.
 */
export function setStageField(
  caseJson: Record<string, unknown>,
  stageId: string,
  field: StageField,
  value: string | boolean
): boolean {
  const node = findNode(caseJson, stageId);
  if (!node || !isStageNode(node)) {
    return false;
  }
  const data = nodeData(node);
  data[field] = value;
  return true;
}

// --- trigger --------------------------------------------------------------

/** Sets the trigger node's `data.label`. Mutates `caseJson`. Returns true on success. */
export function setTriggerLabel(
  caseJson: Record<string, unknown>,
  triggerId: string,
  label: string
): boolean {
  const node = findNode(caseJson, triggerId);
  if (!node || node.type !== 'case-management:Trigger') {
    return false;
  }
  const data = nodeData(node);
  data.label = label;
  return true;
}

// --- edges ----------------------------------------------------------------

/**
 * Appends an edge between two nodes. The edge type is inferred from the source
 * node — a Trigger source yields `case-management:TriggerEdge`, any other a
 * `case-management:Edge`. Four-underscore handle strings are built with the
 * CLI defaults (source=right, target=left). Skips a duplicate (same
 * source/target pair). Mutates `caseJson`. Returns the new edge id, or null
 * when the source/target is missing or a duplicate exists.
 */
export function addEdge(
  caseJson: Record<string, unknown>,
  sourceId: string,
  targetId: string,
  label?: string
): string | null {
  const source = findNode(caseJson, sourceId);
  const target = findNode(caseJson, targetId);
  if (!source || !target) {
    return null;
  }
  const edges = edgesArray(caseJson);
  const duplicate = edges.some(
    (e) => isRecord(e) && e.source === sourceId && e.target === targetId
  );
  if (duplicate) {
    return null;
  }
  const edgeType =
    source.type === 'case-management:Trigger'
      ? 'case-management:TriggerEdge'
      : 'case-management:Edge';
  const edgeId = prefixedId('edge_', 6);
  edges.push({
    id: edgeId,
    type: edgeType,
    source: sourceId,
    target: targetId,
    sourceHandle: `${sourceId}____source____right`,
    targetHandle: `${targetId}____target____left`,
    data: label && label.length > 0 ? { label } : {}
  });
  return edgeId;
}

/** Removes the edge with the given id from `edges[]`. Mutates `caseJson`. */
export function deleteEdge(caseJson: Record<string, unknown>, edgeId: string): boolean {
  const edges = edgesArray(caseJson);
  const index = edges.findIndex((e) => isRecord(e) && e.id === edgeId);
  if (index < 0) {
    return false;
  }
  edges.splice(index, 1);
  return true;
}

/** Sets an edge's `data.label`. Mutates `caseJson`. Returns true on success. */
export function setEdgeLabel(
  caseJson: Record<string, unknown>,
  edgeId: string,
  label: string
): boolean {
  const edges = edgesArray(caseJson);
  const edge = edges.find((e) => isRecord(e) && e.id === edgeId);
  if (!edge) {
    return false;
  }
  if (!isRecord(edge.data)) {
    edge.data = {};
  }
  (edge.data as Record<string, unknown>).label = label;
  return true;
}

// --- conditions (whole-collection replace) --------------------------------

/** A condition collection scope, addressing one editable rule set. */
export type ConditionScope = 'stage-entry' | 'stage-exit' | 'case-exit';

/**
 * Replaces an entire condition collection in one write. `stage-entry` and
 * `stage-exit` target a stage's `data.entryConditions` / `data.exitConditions`;
 * `case-exit` targets the case-level array (`root.caseExitConditions` for v19,
 * `metadata.caseExitRules` for v20). The `conditions` array is written verbatim
 * — callers build the full DNF condition objects. Mutates `caseJson`. Returns
 * true on success.
 */
export function setConditions(
  caseJson: Record<string, unknown>,
  scope: ConditionScope,
  conditions: unknown[],
  stageId?: string
): boolean {
  if (scope === 'case-exit') {
    const schemaVersion = detectCaseSchema(caseJson);
    if (schemaVersion === 'v19') {
      if (!isRecord(caseJson.root)) {
        caseJson.root = {};
      }
      (caseJson.root as Record<string, unknown>).caseExitConditions = conditions;
      // Drop any stale CLI-hybrid copy so `root` stays the single source of truth.
      if (isRecord(caseJson.metadata)) {
        delete (caseJson.metadata as Record<string, unknown>).caseExitRules;
        delete (caseJson.metadata as Record<string, unknown>).caseExitConditions;
      }
    } else {
      if (!isRecord(caseJson.metadata)) {
        caseJson.metadata = {};
      }
      (caseJson.metadata as Record<string, unknown>).caseExitRules = conditions;
    }
    return true;
  }

  if (!stageId) {
    return false;
  }
  const node = findNode(caseJson, stageId);
  if (!node || !isStageNode(node)) {
    return false;
  }
  const data = nodeData(node);
  data[scope === 'stage-entry' ? 'entryConditions' : 'exitConditions'] = conditions;
  return true;
}

// --- SLA (whole-collection replace) ---------------------------------------

/**
 * Replaces an entire `slaRules[]` collection in one write. When `stageId` is
 * given the array is written to that stage's `data.slaRules`; otherwise it
 * targets the case root (`root.data.slaRules` for v19, `metadata.slaRules` for
 * v20). The `slaRules` array is written verbatim. An empty array removes the
 * key. Mutates `caseJson`. Returns true on success.
 */
export function setSlaRules(
  caseJson: Record<string, unknown>,
  slaRules: unknown[],
  stageId?: string
): boolean {
  if (stageId) {
    const node = findNode(caseJson, stageId);
    if (!node || !isStageNode(node)) {
      return false;
    }
    const data = nodeData(node);
    if (slaRules.length === 0) {
      delete data.slaRules;
    } else {
      data.slaRules = slaRules;
    }
    return true;
  }

  const schemaVersion = detectCaseSchema(caseJson);
  const container = rootContainer(caseJson, schemaVersion);
  if (slaRules.length === 0) {
    delete container.slaRules;
  } else {
    container.slaRules = slaRules;
  }
  // v19 writes into `root.data`; drop any stale CLI-hybrid `metadata.slaRules`
  // so `root.data` stays the single source of truth the parser reads.
  if (schemaVersion === 'v19' && isRecord(caseJson.metadata)) {
    delete (caseJson.metadata as Record<string, unknown>).slaRules;
  }
  return true;
}
