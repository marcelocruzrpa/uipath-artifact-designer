/**
 * Pure parsing for a Maestro Flow (`.flow`) document.
 *
 * Classifies nodes by their `type` prefix, resolves ports from each node's
 * matching `definitions[]` entry, merges stored coordinates from the top-level
 * `layout.nodes` map, and surfaces parse diagnostics. No vscode / Node / DOM
 * dependency — imported by both the host and the webview.
 */
import { parseJsonLoose } from '../parseAgent';
import { isRecord } from '../../util/objects';
import { asStringOr } from '../../util/jsonShape';
import type { Diagnostic } from '../types';
import type {
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  FlowPort,
  FlowPosition,
  FlowSize,
  FlowVariable
} from './flowTypes';

/** The fully parsed, classified flow graph. */
export interface FlowParseResult {
  /** Flow `id` (a UUID), when present. */
  id: string;
  /** Flow `name`, when present. */
  name: string;
  /** Workflow file-format version (top-level `version`). */
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: FlowVariable[];
  /** True when at least one node had a stored `layout.nodes[id].position`. */
  hasStoredLayout: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Classifies a node `type` string into a coarse {@link FlowNodeKind}.
 * Matching is by substring so connector / agent variants are covered.
 */
export function classifyNodeType(type: string): FlowNodeKind {
  const t = type.toLowerCase();
  if (t.includes('trigger')) {
    return 'trigger';
  }
  if (t.includes('decision')) {
    return 'decision';
  }
  if (t.includes('switch')) {
    return 'switch';
  }
  if (t.includes('loop')) {
    return 'loop';
  }
  if (t.includes('merge')) {
    return 'merge';
  }
  if (t.includes('terminate')) {
    return 'terminate';
  }
  if (t.includes('.end') || t.endsWith('end') || t.includes('control.end')) {
    return 'end';
  }
  if (t.includes('subflow')) {
    return 'subflow';
  }
  if (t.includes('agent')) {
    return 'agent';
  }
  if (t.includes('connector') || t.includes('.is.') || t.includes('uipath.connector')) {
    return 'connector';
  }
  if (t.includes('action') || t.includes('http') || t.includes('script') || t.includes('transform')) {
    return 'action';
  }
  return 'unknown';
}

/** Reads ports out of a definition's `handleConfiguration` block. */
function portsFromDefinition(definition: Record<string, unknown>): FlowPort[] {
  const ports: FlowPort[] = [];
  const groups = definition.handleConfiguration;
  if (!Array.isArray(groups)) {
    return ports;
  }
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.handles)) {
      continue;
    }
    for (const handle of group.handles) {
      if (!isRecord(handle) || typeof handle.id !== 'string') {
        continue;
      }
      const direction = handle.type === 'source' ? 'source' : 'target';
      const port: FlowPort = { id: handle.id, direction };
      if (typeof handle.label === 'string') {
        port.label = handle.label;
      }
      ports.push(port);
    }
  }
  return ports;
}

/**
 * Fallback ports for a node kind when its definition carries no
 * `handleConfiguration` (e.g. a flow authored without registry definitions).
 */
function defaultPortsForKind(kind: FlowNodeKind): FlowPort[] {
  switch (kind) {
    case 'trigger':
      return [{ id: 'output', direction: 'source' }];
    case 'decision':
      return [
        { id: 'input', direction: 'target' },
        { id: 'true', direction: 'source' },
        { id: 'false', direction: 'source' }
      ];
    case 'switch':
      return [
        { id: 'input', direction: 'target' },
        { id: 'default', direction: 'source' }
      ];
    case 'loop':
      return [
        { id: 'input', direction: 'target' },
        { id: 'loopBack', direction: 'target' },
        { id: 'success', direction: 'source' },
        { id: 'output', direction: 'source' }
      ];
    case 'end':
    case 'terminate':
      return [{ id: 'input', direction: 'target' }];
    case 'merge':
      return [
        { id: 'input', direction: 'target' },
        { id: 'output', direction: 'source' }
      ];
    default:
      return [
        { id: 'input', direction: 'target' },
        { id: 'success', direction: 'source' },
        { id: 'error', direction: 'source' }
      ];
  }
}

/** Indexes `definitions[]` by `nodeType` (last entry wins on duplicates). */
function indexDefinitions(raw: unknown): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(raw)) {
    return index;
  }
  for (const entry of raw) {
    if (isRecord(entry) && typeof entry.nodeType === 'string') {
      index.set(entry.nodeType, entry);
    }
  }
  return index;
}

/** Reads a `layout.nodes[id]` entry into position / size / collapsed. */
function readLayoutEntry(entry: unknown): {
  position: FlowPosition | null;
  size: FlowSize | null;
  collapsed: boolean;
} {
  if (!isRecord(entry)) {
    return { position: null, size: null, collapsed: false };
  }
  let position: FlowPosition | null = null;
  if (isRecord(entry.position)) {
    const x = entry.position.x;
    const y = entry.position.y;
    if (typeof x === 'number' && typeof y === 'number') {
      position = { x, y };
    }
  }
  let size: FlowSize | null = null;
  if (isRecord(entry.size)) {
    const w = entry.size.width;
    const h = entry.size.height;
    if (typeof w === 'number' && typeof h === 'number') {
      size = { width: w, height: h };
    }
  }
  return { position, size, collapsed: entry.collapsed === true };
}

/** Parses one raw `nodes[]` entry into a classified {@link FlowNode}. */
function parseNode(
  raw: unknown,
  definitions: Map<string, Record<string, unknown>>,
  layoutNodes: Record<string, unknown>
): FlowNode | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    return null;
  }
  const type = asStringOr(raw.type, 'unknown');
  const kind = classifyNodeType(type);

  const definition = definitions.get(type);
  let ports = definition ? portsFromDefinition(definition) : [];
  if (ports.length === 0) {
    ports = defaultPortsForKind(kind);
  }

  const display = isRecord(raw.display) ? raw.display : {};
  const label = asStringOr(display.label, '').trim() || raw.id;

  const layout = readLayoutEntry(layoutNodes[raw.id]);

  return {
    id: raw.id,
    type,
    typeVersion: asStringOr(raw.typeVersion, '1.0'),
    kind,
    label,
    inputs: ports.filter((p) => p.direction === 'target'),
    outputs: ports.filter((p) => p.direction === 'source'),
    position: layout.position,
    size: layout.size,
    collapsed: layout.collapsed,
    rawInputs: isRecord(raw.inputs) ? raw.inputs : {}
  };
}

/** Parses one raw `edges[]` entry. */
function parseEdge(raw: unknown): FlowEdge | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.sourceNodeId !== 'string' || typeof raw.targetNodeId !== 'string') {
    return null;
  }
  return {
    id: asStringOr(raw.id, '') || `${raw.sourceNodeId}-${raw.targetNodeId}`,
    sourceNodeId: raw.sourceNodeId,
    sourcePort: asStringOr(raw.sourcePort, 'output'),
    targetNodeId: raw.targetNodeId,
    targetPort: asStringOr(raw.targetPort, 'input')
  };
}

/** Parses `variables.globals[]` into {@link FlowVariable} records. */
function parseVariables(raw: unknown): FlowVariable[] {
  const variables: FlowVariable[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.globals)) {
    return variables;
  }
  for (const entry of raw.globals) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      continue;
    }
    const variable: FlowVariable = {
      id: entry.id,
      direction: asStringOr(entry.direction, 'in'),
      type: asStringOr(entry.type, 'string')
    };
    if (entry.defaultValue !== undefined && entry.defaultValue !== null) {
      variable.defaultValue = String(entry.defaultValue);
    }
    if (typeof entry.description === 'string' && entry.description.length > 0) {
      variable.description = entry.description;
    }
    variables.push(variable);
  }
  return variables;
}

/**
 * Parses a `.flow` document text into a classified {@link FlowParseResult}.
 * Never throws — a JSON error is reported through {@link FlowParseResult.diagnostics}.
 */
export function parseFlow(text: string): FlowParseResult {
  const empty: FlowParseResult = {
    id: '',
    name: '',
    version: '',
    nodes: [],
    edges: [],
    variables: [],
    hasStoredLayout: false,
    diagnostics: []
  };

  const parsed = parseJsonLoose(text);
  if (parsed.error) {
    return { ...empty, diagnostics: [{ severity: 'warning', message: parsed.error }] };
  }
  if (!isRecord(parsed.json)) {
    return {
      ...empty,
      diagnostics: [{ severity: 'warning', message: 'Flow file is not a JSON object.' }]
    };
  }

  const json = parsed.json;
  const diagnostics: Diagnostic[] = [];

  const definitions = indexDefinitions(json.definitions);
  const layoutNodes =
    isRecord(json.layout) && isRecord(json.layout.nodes) ? json.layout.nodes : {};

  const nodes: FlowNode[] = [];
  if (Array.isArray(json.nodes)) {
    for (const raw of json.nodes) {
      const node = parseNode(raw, definitions, layoutNodes);
      if (node) {
        nodes.push(node);
      }
    }
  }

  const edges: FlowEdge[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (Array.isArray(json.edges)) {
    for (const raw of json.edges) {
      const edge = parseEdge(raw);
      if (!edge) {
        continue;
      }
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
        diagnostics.push({
          severity: 'warning',
          message: `Edge "${edge.id}" references a node that does not exist.`
        });
        continue;
      }
      edges.push(edge);
    }
  }

  if (nodes.length === 0) {
    diagnostics.push({
      severity: 'info',
      message: 'This flow has no nodes yet.'
    });
  }

  return {
    id: asStringOr(json.id, ''),
    name: asStringOr(json.name, ''),
    version: asStringOr(json.version, ''),
    nodes,
    edges,
    variables: parseVariables(json.variables),
    hasStoredLayout: nodes.some((n) => n.position !== null),
    diagnostics
  };
}
