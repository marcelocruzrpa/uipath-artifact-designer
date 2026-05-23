/**
 * Pure mutators for a Maestro Flow (`.flow`) JSON document.
 *
 * Each function takes the parsed flow JSON object and mutates it in place,
 * mirroring the `editAgent.ts` style. No vscode / Node / DOM dependency — these
 * run host-side inside `flowDescriptor.applyEdit`, before the file is
 * re-serialized with {@link serializeJson}.
 */
import { serializeJson } from '../editAgent';
import { isRecord } from '../../util/objects';

export { serializeJson };

/** Returns the `nodes[]` array, creating it when absent. Mutates `flow`. */
function nodesArray(flow: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(flow.nodes)) {
    flow.nodes = [];
  }
  return flow.nodes as Record<string, unknown>[];
}

/** Returns the `edges[]` array, creating it when absent. Mutates `flow`. */
function edgesArray(flow: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(flow.edges)) {
    flow.edges = [];
  }
  return flow.edges as Record<string, unknown>[];
}

/** Returns the `layout.nodes` object, creating it when absent. Mutates `flow`. */
function layoutNodes(flow: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(flow.layout)) {
    flow.layout = {};
  }
  const layout = flow.layout as Record<string, unknown>;
  if (!isRecord(layout.nodes)) {
    layout.nodes = {};
  }
  return layout.nodes as Record<string, unknown>;
}

/** Finds a node object by id within `nodes[]`. */
function findNode(
  flow: Record<string, unknown>,
  nodeId: string
): Record<string, unknown> | undefined {
  return nodesArray(flow).find((n) => isRecord(n) && n.id === nodeId);
}

/** Sets a node's `display.label`. Mutates `flow`. Returns true on success. */
export function setNodeLabel(
  flow: Record<string, unknown>,
  nodeId: string,
  label: string
): boolean {
  const node = findNode(flow, nodeId);
  if (!node) {
    return false;
  }
  const display = isRecord(node.display) ? node.display : {};
  display.label = label;
  node.display = display;
  return true;
}

/**
 * Sets a single `inputs.<key>` value on a node. An empty string clears the key.
 * Mutates `flow`. Returns true on success.
 */
export function setNodeInput(
  flow: Record<string, unknown>,
  nodeId: string,
  key: string,
  value: string
): boolean {
  const node = findNode(flow, nodeId);
  if (!node) {
    return false;
  }
  const inputs = isRecord(node.inputs) ? node.inputs : {};
  if (value.length === 0) {
    delete inputs[key];
  } else {
    inputs[key] = value;
  }
  node.inputs = inputs;
  return true;
}

/**
 * Writes a node's canvas position into `layout.nodes[id].position`, preserving
 * any existing `size` / `collapsed`. Mutates `flow`. Returns true on success.
 */
export function setNodePosition(
  flow: Record<string, unknown>,
  nodeId: string,
  x: number,
  y: number
): boolean {
  if (!findNode(flow, nodeId)) {
    return false;
  }
  const nodes = layoutNodes(flow);
  const entry = isRecord(nodes[nodeId]) ? (nodes[nodeId] as Record<string, unknown>) : {};
  entry.position = { x: Math.round(x), y: Math.round(y) };
  nodes[nodeId] = entry;
  return true;
}

/**
 * Appends an edge to `edges[]`. Skips a duplicate (same source/target/ports).
 * Mutates `flow`. Returns true when an edge was added.
 */
export function addEdge(
  flow: Record<string, unknown>,
  edge: {
    id: string;
    sourceNodeId: string;
    sourcePort: string;
    targetNodeId: string;
    targetPort: string;
  }
): boolean {
  const edges = edgesArray(flow);
  const duplicate = edges.some(
    (e) =>
      isRecord(e) &&
      e.sourceNodeId === edge.sourceNodeId &&
      e.sourcePort === edge.sourcePort &&
      e.targetNodeId === edge.targetNodeId &&
      e.targetPort === edge.targetPort
  );
  if (duplicate) {
    return false;
  }
  edges.push({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    sourcePort: edge.sourcePort,
    targetNodeId: edge.targetNodeId,
    targetPort: edge.targetPort
  });
  return true;
}

/** Removes the edge with the given id from `edges[]`. Mutates `flow`. */
export function removeEdge(flow: Record<string, unknown>, edgeId: string): boolean {
  const edges = edgesArray(flow);
  const index = edges.findIndex((e) => isRecord(e) && e.id === edgeId);
  if (index < 0) {
    return false;
  }
  edges.splice(index, 1);
  return true;
}

/**
 * Removes a node and cascades: drops every edge touching it, its
 * `layout.nodes` entry, its `variables.nodes` entries, and any
 * `variables.variableUpdates` keyed by the node. Mutates `flow`.
 */
export function removeNode(flow: Record<string, unknown>, nodeId: string): boolean {
  const nodes = nodesArray(flow);
  const index = nodes.findIndex((n) => isRecord(n) && n.id === nodeId);
  if (index < 0) {
    return false;
  }
  nodes.splice(index, 1);

  // Cascade: edges touching this node.
  const edges = edgesArray(flow);
  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];
    if (isRecord(edge) && (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)) {
      edges.splice(i, 1);
    }
  }

  // Cascade: layout entry.
  if (isRecord(flow.layout) && isRecord((flow.layout as Record<string, unknown>).nodes)) {
    delete (
      (flow.layout as Record<string, unknown>).nodes as Record<string, unknown>
    )[nodeId];
  }

  // Cascade: node variables + variable updates.
  if (isRecord(flow.variables)) {
    const variables = flow.variables as Record<string, unknown>;
    if (Array.isArray(variables.nodes)) {
      variables.nodes = (variables.nodes as unknown[]).filter(
        (v) => !(isRecord(v) && isRecord(v.binding) && v.binding.nodeId === nodeId)
      );
    }
    if (isRecord(variables.variableUpdates)) {
      delete (variables.variableUpdates as Record<string, unknown>)[nodeId];
    }
  }

  return true;
}

/**
 * Appends a new node to `nodes[]` with the given id / type / label, plus a
 * placeholder `layout.nodes` entry. Mutates `flow`. Returns true when added.
 */
export function addNode(
  flow: Record<string, unknown>,
  node: {
    id: string;
    type: string;
    typeVersion: string;
    label: string;
    position: { x: number; y: number };
  }
): boolean {
  const nodes = nodesArray(flow);
  if (nodes.some((n) => isRecord(n) && n.id === node.id)) {
    return false;
  }
  nodes.push({
    id: node.id,
    type: node.type,
    typeVersion: node.typeVersion,
    display: { label: node.label },
    inputs: {}
  });
  const layout = layoutNodes(flow);
  layout[node.id] = {
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    size: { width: 96, height: 96 },
    collapsed: false
  };
  return true;
}
