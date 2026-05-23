/**
 * Pure, deterministic graph layout — UiPath Studio Web style directional lanes.
 * Imported by the webview. No DOM / Node / vscode dependency.
 *
 * The agent sits at the origin. Escalations grow upward; Context, Tools and any
 * other resources grow downward in side-by-side lanes. Each lane has a labelled
 * junction between the agent and its resource nodes.
 */

export type LaneGroup = 'tool' | 'context' | 'escalation' | 'memory' | 'other';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AgentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A resource node, positioned by its circle center. */
export interface LaidOutNode {
  id: string;
  cx: number;
  cy: number;
}

export interface LaneLayout {
  group: LaneGroup;
  label: string;
  direction: 'up' | 'down';
  junction: { x: number; y: number };
  nodes: LaidOutNode[];
}

export interface GraphLayout {
  agent: AgentBox;
  lanes: LaneLayout[];
}

export interface ResourceRef {
  id: string;
  group: LaneGroup;
}

export const AGENT_SIZE = { w: 324, h: 198 };
export const NODE_CIRCLE = 66;
export const NODE_CELL = { w: 152, h: 130 };

const AGENT_TO_JUNCTION = 66;
const JUNCTION_TO_ROW = 88;
const ROW_GAP = 142;
const LANE_GAP = 88;
const PER_ROW = 6;

const GROUP_LABELS: Record<LaneGroup, string> = {
  tool: 'Tools',
  context: 'Context',
  escalation: 'Escalations',
  memory: 'Memory',
  other: 'Resources'
};

function laneRowWidth(count: number): number {
  return Math.max(1, Math.min(count, PER_ROW)) * NODE_CELL.w;
}

/** Places resource node circles in centered, wrapping rows around a column center. */
function placeRowNodes(
  ids: string[],
  centerX: number,
  firstRowCy: number,
  direction: 'up' | 'down'
): LaidOutNode[] {
  const nodes: LaidOutNode[] = [];
  for (let i = 0; i < ids.length; i++) {
    const row = Math.floor(i / PER_ROW);
    const indexInRow = i % PER_ROW;
    const countInRow = Math.min(PER_ROW, ids.length - row * PER_ROW);
    const cy = direction === 'down' ? firstRowCy + row * ROW_GAP : firstRowCy - row * ROW_GAP;
    const cx = centerX - ((countInRow - 1) * NODE_CELL.w) / 2 + indexInRow * NODE_CELL.w;
    nodes.push({ id: ids[i], cx, cy });
  }
  return nodes;
}

/** Builds the full directional-lane layout. Resources arrive already sorted. */
export function computeLayout(resources: ResourceRef[]): GraphLayout {
  const agent: AgentBox = {
    x: -AGENT_SIZE.w / 2,
    y: -AGENT_SIZE.h / 2,
    w: AGENT_SIZE.w,
    h: AGENT_SIZE.h
  };

  const byGroup: Record<LaneGroup, string[]> = {
    tool: [],
    context: [],
    escalation: [],
    memory: [],
    other: []
  };
  for (const resource of resources) {
    (byGroup[resource.group] ?? byGroup.other).push(resource.id);
  }

  const lanes: LaneLayout[] = [];
  const agentTop = agent.y;
  const agentBottom = agent.y + agent.h;

  // Escalations lane — above the agent.
  if (byGroup.escalation.length > 0) {
    const junctionY = agentTop - AGENT_TO_JUNCTION;
    lanes.push({
      group: 'escalation',
      label: GROUP_LABELS.escalation,
      direction: 'up',
      junction: { x: 0, y: junctionY },
      nodes: placeRowNodes(byGroup.escalation, 0, junctionY - JUNCTION_TO_ROW, 'up')
    });
  }

  // Context / Tools / Other lanes — below the agent, side by side.
  const bottomGroups: LaneGroup[] = ['context', 'tool', 'memory', 'other'];
  const present = bottomGroups.filter((g) => byGroup[g].length > 0);
  const widths = present.map((g) => laneRowWidth(byGroup[g].length));
  const totalWidth =
    widths.reduce((sum, w) => sum + w, 0) + LANE_GAP * Math.max(0, present.length - 1);
  const junctionY = agentBottom + AGENT_TO_JUNCTION;

  let cursor = -totalWidth / 2;
  for (let i = 0; i < present.length; i++) {
    const group = present[i];
    const width = widths[i];
    const centerX = cursor + width / 2;
    cursor += width + LANE_GAP;
    lanes.push({
      group,
      label: GROUP_LABELS[group],
      direction: 'down',
      junction: { x: centerX, y: junctionY },
      nodes: placeRowNodes(byGroup[group], centerX, junctionY + JUNCTION_TO_ROW, 'down')
    });
  }

  return { agent, lanes };
}

/** Bounding box over the agent, every junction and every resource node. */
export function layoutBounds(layout: GraphLayout): BBox {
  let minX = layout.agent.x;
  let minY = layout.agent.y;
  let maxX = layout.agent.x + layout.agent.w;
  let maxY = layout.agent.y + layout.agent.h;

  const extend = (x: number, y: number, halfW: number, halfH: number): void => {
    minX = Math.min(minX, x - halfW);
    maxX = Math.max(maxX, x + halfW);
    minY = Math.min(minY, y - halfH);
    maxY = Math.max(maxY, y + halfH);
  };

  for (const lane of layout.lanes) {
    extend(lane.junction.x, lane.junction.y, 78, 22);
    for (const node of lane.nodes) {
      extend(node.cx, node.cy, NODE_CELL.w / 2, NODE_CELL.h / 2);
    }
  }
  return { minX, minY, maxX, maxY };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(3, Math.max(0.25, zoom));
}
