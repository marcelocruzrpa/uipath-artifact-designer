/**
 * Pure dagre layout for the coded-workflow project call graph (T2.3).
 *
 * Mirrors the Case canvas layout (`renderers/case/caseLayout.ts`): dagre lays
 * the graph out left-to-right, dagre's node CENTERS are converted to top-left
 * corners, and dagre's routed edge points are passed through for path
 * rendering. No DOM and no postMessage here — this module is unit-testable in
 * a plain Node environment.
 *
 * Determinism: dagre is deterministic for a given insertion order, and the
 * assembler (`assembleGraph`) already emits nodes/edges in a deterministic
 * order, so identical graphs always produce identical layouts.
 */
import dagre from 'dagre';
import type {
  CodedGraphEdge,
  CodedGraphNode,
  CodedProjectGraph,
  GraphNodeKind
} from '../../../src/model/codedWorkflow/graph/graphTypes';

export interface GraphPoint {
  x: number;
  y: number;
}

/** A positioned node box in world coordinates (top-left corner). */
export interface PositionedNode {
  node: CodedGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An edge plus its routed polyline (start/end land on node borders). */
export interface RoutedEdge {
  edge: CodedGraphEdge;
  /** Always at least two points. */
  points: GraphPoint[];
}

export interface GraphLayoutResult {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  /** Bounding size of the laid-out content including margins. */
  width: number;
  height: number;
}

/** Node box sizes by kind — workflows largest, satellites smaller. */
const NODE_SIZES: Record<GraphNodeKind, { width: number; height: number }> = {
  'coded-workflow': { width: 220, height: 64 },
  'xaml-workflow': { width: 200, height: 56 },
  'helper-class': { width: 180, height: 44 },
  unresolved: { width: 180, height: 44 }
};

const RANK_SEP = 110;
const NODE_SEP = 56;
const MARGIN = 24;

/** The box size used for a node kind (exported for tests / the view). */
export function nodeSize(kind: GraphNodeKind): { width: number; height: number } {
  return NODE_SIZES[kind];
}

function isFinitePoint(p: { x: number; y: number } | undefined): p is GraphPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Straight-line (or self-loop) fallback for edges dagre did not route —
 * defensive only; assembled graphs never carry dangling edge endpoints.
 */
function fallbackPoints(
  edge: CodedGraphEdge,
  byId: Map<string, PositionedNode>
): GraphPoint[] {
  const a = byId.get(edge.source);
  const b = byId.get(edge.target);
  if (!a || !b) {
    return [
      { x: 0, y: 0 },
      { x: 0, y: 0 }
    ];
  }
  if (a === b) {
    // Self edge: a small loop off the node's right border.
    const x = a.x + a.width;
    const y = a.y + a.height / 2;
    return [
      { x, y: y - 10 },
      { x: x + 36, y },
      { x, y: y + 10 }
    ];
  }
  return [
    { x: a.x + a.width, y: a.y + a.height / 2 },
    { x: b.x, y: b.y + b.height / 2 }
  ];
}

/** Lays a project call graph out left-to-right; returns positioned nodes + routed edges. */
export function layoutGraph(graph: CodedProjectGraph): GraphLayoutResult {
  // Multigraph: two edges of different kinds may connect the same node pair
  // (edge.id is unique by contract) — both must survive the layout.
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'LR',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: MARGIN,
    marginy: MARGIN
  });
  g.setDefaultEdgeLabel(() => ({}));

  const known = new Set<string>();
  for (const node of graph.nodes) {
    const size = NODE_SIZES[node.kind];
    g.setNode(node.id, { width: size.width, height: size.height });
    known.add(node.id);
  }
  for (const edge of graph.edges) {
    if (known.has(edge.source) && known.has(edge.target)) {
      g.setEdge(edge.source, edge.target, {}, edge.id);
    }
  }

  if (graph.nodes.length > 0) {
    dagre.layout(g);
  }

  const nodes: PositionedNode[] = graph.nodes.map((node) => {
    const size = NODE_SIZES[node.kind];
    const laid = g.node(node.id);
    // dagre reports the node center; convert to a top-left corner.
    return {
      node,
      x: (laid?.x ?? 0) - size.width / 2,
      y: (laid?.y ?? 0) - size.height / 2,
      width: size.width,
      height: size.height
    };
  });
  const byId = new Map(nodes.map((p) => [p.node.id, p]));

  const edges: RoutedEdge[] = graph.edges.map((edge) => {
    const laid =
      known.has(edge.source) && known.has(edge.target)
        ? g.edge(edge.source, edge.target, edge.id)
        : undefined;
    const points = (laid?.points ?? []).filter(isFinitePoint).map((p) => ({ x: p.x, y: p.y }));
    return {
      edge,
      points: points.length >= 2 ? points : fallbackPoints(edge, byId)
    };
  });

  // Content bounds (dagre's marginx/marginy already shifted everything
  // positive); pad the far side by the same margin.
  let maxX = 0;
  let maxY = 0;
  for (const p of nodes) {
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  for (const e of edges) {
    for (const pt of e.points) {
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return {
    nodes,
    edges,
    width: maxX + MARGIN,
    height: maxY + MARGIN
  };
}
