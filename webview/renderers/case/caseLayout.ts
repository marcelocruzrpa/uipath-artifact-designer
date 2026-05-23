/**
 * Layout resolution for the Maestro Case canvas.
 *
 * Lays the trigger + stage graph out left-to-right with `dagre`. Unlike the
 * Flow canvas, Case stages carry no authored canvas coordinates worth honoring
 * (v20 strips them entirely; v19 positions are CLI-computed columns), so every
 * node is auto-placed. Sticky notes are not part of the directed graph — they
 * are stacked in a side column.
 */
import dagre from 'dagre';
import type { CaseEdge, CaseStage, CaseStickyNote, CaseTrigger } from '../../../src/model/types';

/** A resolved node box in canvas (world) coordinates. */
export interface PlacedCaseNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The full positioned graph plus its bounding box. */
export interface CaseGraphLayout {
  nodes: Map<string, PlacedCaseNode>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Trigger node box. */
export const TRIGGER_W = 150;
export const TRIGGER_H = 64;
/** Stage / exception-stage card box. */
export const STAGE_W = 248;
export const STAGE_H = 132;
/** Sticky-note card box. */
export const STICKY_W = 200;
export const STICKY_H = 110;

const RANK_SEP = 110;
const NODE_SEP = 56;
const STICKY_GAP = 24;

/**
 * Computes a position for the trigger, every stage and every sticky note.
 * The directed graph (trigger + stages + edges) is laid out left-to-right with
 * dagre; sticky notes are stacked below the graph in a separate column.
 */
export function layoutCase(
  trigger: CaseTrigger | null,
  stages: CaseStage[],
  stickyNotes: CaseStickyNote[],
  edges: CaseEdge[]
): CaseGraphLayout {
  const placed = new Map<string, PlacedCaseNode>();

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));

  const graphIds = new Set<string>();
  if (trigger) {
    graph.setNode(trigger.id, { width: TRIGGER_W, height: TRIGGER_H });
    graphIds.add(trigger.id);
  }
  for (const stage of stages) {
    graph.setNode(stage.id, { width: STAGE_W, height: STAGE_H });
    graphIds.add(stage.id);
  }
  for (const edge of edges) {
    if (graphIds.has(edge.source) && graphIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  if (graphIds.size > 0) {
    dagre.layout(graph);
  }

  const sizeFor = (id: string): { width: number; height: number } => {
    if (trigger && id === trigger.id) {
      return { width: TRIGGER_W, height: TRIGGER_H };
    }
    return { width: STAGE_W, height: STAGE_H };
  };

  for (const id of graphIds) {
    const laid = graph.node(id);
    const size = sizeFor(id);
    // dagre reports the node center; convert to a top-left corner.
    placed.set(id, {
      id,
      x: (laid?.x ?? 0) - size.width / 2,
      y: (laid?.y ?? 0) - size.height / 2,
      width: size.width,
      height: size.height
    });
  }

  // Bounding box over the directed graph so far.
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
    maxX = STAGE_W;
    maxY = STAGE_H;
  }

  // Stack sticky notes in a column below the graph.
  let stickyY = maxY + RANK_SEP;
  for (const note of stickyNotes) {
    placed.set(note.id, {
      id: note.id,
      x: minX,
      y: stickyY,
      width: STICKY_W,
      height: STICKY_H
    });
    stickyY += STICKY_H + STICKY_GAP;
  }
  for (const p of placed.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  return { nodes: placed, bounds: { minX, minY, maxX, maxY } };
}
