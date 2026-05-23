/**
 * Layout resolution for the Flow canvas.
 *
 * Honors the coordinates stored in `.flow` `layout.nodes` and falls back to a
 * `dagre` left-to-right auto-layout only for nodes that lack a stored position.
 */
import dagre from 'dagre';
import type { FlowEdge, FlowNode } from '../../../src/model/types';

/** A resolved node box in canvas (world) coordinates. */
export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The full positioned graph plus its bounding box. */
export interface FlowGraphLayout {
  nodes: Map<string, PlacedNode>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Default rendered node-card box. */
export const NODE_W = 188;
export const NODE_H = 84;

const RANK_SEP = 96;
const NODE_SEP = 48;

/**
 * Computes a position for every node. Nodes with a stored `position` keep it;
 * the rest are laid out left-to-right with dagre and offset so they do not
 * overlap the stored-position cluster.
 */
export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowGraphLayout {
  const placed = new Map<string, PlacedNode>();

  // 1. Place nodes that carry stored coordinates verbatim.
  const needsAuto: FlowNode[] = [];
  for (const node of nodes) {
    const width = node.size?.width && node.size.width > 0 ? node.size.width : NODE_W;
    const height = node.size?.height && node.size.height > 0 ? node.size.height : NODE_H;
    if (node.position) {
      placed.set(node.id, {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width,
        height
      });
    } else {
      needsAuto.push(node);
    }
  }

  // 2. Auto-layout the remaining nodes with dagre.
  if (needsAuto.length > 0) {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 20, marginy: 20 });
    graph.setDefaultEdgeLabel(() => ({}));

    const autoIds = new Set(needsAuto.map((n) => n.id));
    for (const node of needsAuto) {
      graph.setNode(node.id, { width: NODE_W, height: NODE_H });
    }
    for (const edge of edges) {
      if (autoIds.has(edge.sourceNodeId) && autoIds.has(edge.targetNodeId)) {
        graph.setEdge(edge.sourceNodeId, edge.targetNodeId);
      }
    }
    dagre.layout(graph);

    // Offset the auto cluster below any stored-position nodes.
    let offsetY = 0;
    if (placed.size > 0) {
      let maxY = -Infinity;
      for (const p of placed.values()) {
        maxY = Math.max(maxY, p.y + p.height);
      }
      offsetY = maxY + RANK_SEP;
    }

    for (const node of needsAuto) {
      const laid = graph.node(node.id);
      // dagre reports the node center; convert to a top-left corner.
      placed.set(node.id, {
        id: node.id,
        x: (laid?.x ?? 0) - NODE_W / 2,
        y: (laid?.y ?? 0) - NODE_H / 2 + offsetY,
        width: NODE_W,
        height: NODE_H
      });
    }
  }

  // 3. Bounding box over every placed node.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = NODE_W;
    maxY = NODE_H;
  }

  return { nodes: placed, bounds: { minX, minY, maxX, maxY } };
}
