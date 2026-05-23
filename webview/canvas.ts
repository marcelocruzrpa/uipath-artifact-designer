/** The pannable / zoomable node-graph canvas — UiPath Studio Web style. */
import type { AgentModel } from '../src/model/types';
import {
  type AgentBox,
  type GraphLayout,
  type LaneLayout,
  NODE_CELL,
  NODE_CIRCLE,
  computeLayout,
  layoutBounds
} from '../src/model/layout';
import { arrowDirection, nearestInDirection } from './canvasNav';
import { createAgentCard, createJunction, createResourceNode } from './components/nodeCard';
import { PanZoom, type Transform } from './interaction';
import { clearChildren, deepEqual, el, svgEl } from './util';

/** Offset applied so all node coordinates stay positive within the world layer. */
const ORIGIN = 4000;
const WORLD_SIZE = 8000;
const AGENT_ID = '__agent__';
const CIRCLE_R = NODE_CIRCLE / 2;

export type Selection = { kind: 'agent' } | { kind: 'resource'; id: string } | null;

export class Canvas {
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly edgeLayer: SVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly panzoom: PanZoom;
  private readonly cards = new Map<string, HTMLElement>();
  private layout: GraphLayout | null = null;
  private selection: Selection = null;
  /** The model the current DOM was built from — used to skip redundant rebuilds. */
  private renderedModel: AgentModel | null = null;

  public onSelect: ((selection: Selection) => void) | null = null;
  public onViewChange: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.stage = el('div', { class: 'stage' });
    this.world = el('div', { class: 'world' });
    this.world.style.width = `${WORLD_SIZE}px`;
    this.world.style.height = `${WORLD_SIZE}px`;
    this.edgeLayer = svgEl('svg', { class: 'edge-layer', width: WORLD_SIZE, height: WORLD_SIZE });
    this.nodeLayer = el('div', { class: 'node-layer' });
    this.world.append(this.edgeLayer, this.nodeLayer);
    this.stage.append(this.world);
    host.append(this.stage);

    this.panzoom = new PanZoom(this.stage, this.world);
    this.panzoom.onChange = () => this.onViewChange?.();

    this.stage.addEventListener('click', (e) => {
      if (this.panzoom.consumeSuppressedClick()) {
        return;
      }
      if (!(e.target as HTMLElement).closest('.node')) {
        this.userSelect(null);
      }
    });
    this.stage.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('.node')) {
        this.fit();
      }
    });
  }

  render(model: AgentModel): void {
    // Dirty check: if the model is structurally identical to what is already
    // on screen, the DOM is already correct — skip the full teardown/rebuild.
    if (this.renderedModel && deepEqual(this.renderedModel, model)) {
      return;
    }
    this.renderedModel = model;

    clearChildren(this.edgeLayer);
    clearChildren(this.nodeLayer);
    this.cards.clear();
    this.selection = null;

    const layout = computeLayout(model.resources.map((r) => ({ id: r.id, group: r.group })));
    this.layout = layout;
    const byId = new Map(model.resources.map((r) => [r.id, r]));

    // Agent card.
    const agentCard = createAgentCard(model);
    agentCard.style.left = `${ORIGIN + layout.agent.x}px`;
    agentCard.style.top = `${ORIGIN + layout.agent.y}px`;
    agentCard.style.width = `${layout.agent.w}px`;
    agentCard.style.height = `${layout.agent.h}px`;
    this.registerCard(AGENT_ID, agentCard, { kind: 'agent' });
    this.nodeLayer.append(agentCard);

    // Lanes: connectors, junction puck, resource circles.
    for (const lane of layout.lanes) {
      this.drawLaneConnectors(lane, layout.agent);

      const junction = createJunction(lane.label, lane.nodes.length, lane.group);
      junction.style.left = `${ORIGIN + lane.junction.x}px`;
      junction.style.top = `${ORIGIN + lane.junction.y}px`;
      this.nodeLayer.append(junction);

      for (const laidOut of lane.nodes) {
        const resource = byId.get(laidOut.id);
        if (!resource) {
          continue;
        }
        const circle = createResourceNode(resource);
        circle.style.left = `${ORIGIN + laidOut.cx - NODE_CELL.w / 2}px`;
        circle.style.top = `${ORIGIN + laidOut.cy - CIRCLE_R}px`;
        circle.style.width = `${NODE_CELL.w}px`;
        this.registerCard(resource.id, circle, { kind: 'resource', id: resource.id });
        this.nodeLayer.append(circle);
      }
    }
  }

  private drawLaneConnectors(lane: LaneLayout, agentBox: AgentBox): void {
    const up = lane.direction === 'up';
    const jx = ORIGIN + lane.junction.x;
    const jy = ORIGIN + lane.junction.y;

    // Agent edge -> junction (vertical / horizontal / vertical elbow).
    const agentLeft = ORIGIN + agentBox.x;
    const agentRight = agentLeft + agentBox.w;
    const agentEdgeY = up ? ORIGIN + agentBox.y : ORIGIN + agentBox.y + agentBox.h;
    const exitX = Math.min(agentRight - 32, Math.max(agentLeft + 32, jx));
    const midY = (agentEdgeY + jy) / 2;
    this.addPath(`M ${exitX} ${agentEdgeY} L ${exitX} ${midY} L ${jx} ${midY} L ${jx} ${jy}`, lane.group);

    if (lane.nodes.length === 0) {
      return;
    }

    // Group nodes into rows by their y coordinate.
    const rows = new Map<number, number[]>();
    lane.nodes.forEach((node, index) => {
      const list = rows.get(node.cy) ?? [];
      list.push(index);
      rows.set(node.cy, list);
    });

    let spineEnd = jy;
    for (const [cy, indices] of rows) {
      const worldCy = ORIGIN + cy;
      const busY = up ? worldCy + CIRCLE_R + 24 : worldCy - CIRCLE_R - 24;
      spineEnd = up ? Math.min(spineEnd, busY) : Math.max(spineEnd, busY);

      const xs = indices.map((i) => ORIGIN + lane.nodes[i].cx);
      const minX = Math.min(jx, ...xs);
      const maxX = Math.max(jx, ...xs);
      this.addPath(`M ${minX} ${busY} L ${maxX} ${busY}`, lane.group);

      for (const i of indices) {
        const cx = ORIGIN + lane.nodes[i].cx;
        const tipY = up ? worldCy + CIRCLE_R : worldCy - CIRCLE_R;
        this.addPath(`M ${cx} ${busY} L ${cx} ${tipY}`, lane.group);
        this.addDiamond(cx, tipY, lane.group);
      }
    }
    // Spine from the junction to the farthest row bus.
    this.addPath(`M ${jx} ${jy} L ${jx} ${spineEnd}`, lane.group);
  }

  private addPath(d: string, group: string): void {
    this.edgeLayer.append(svgEl('path', { d, class: `conn conn--${group}` }));
  }

  private addDiamond(x: number, y: number, group: string): void {
    const s = 4.5;
    this.edgeLayer.append(
      svgEl('path', {
        d: `M ${x} ${y - s} L ${x + s} ${y} L ${x} ${y + s} L ${x - s} ${y} Z`,
        class: `conn-tip conn-tip--${group}`
      })
    );
  }

  private registerCard(id: string, element: HTMLElement, selection: Selection): void {
    this.cards.set(id, element);
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      this.userSelect(selection);
    });
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.userSelect(selection);
        return;
      }
      // Arrow keys move focus to the nearest node in that direction.
      const direction = arrowDirection(e.key);
      if (!direction) {
        return;
      }
      const next = nearestInDirection(element, this.cards.values(), direction);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    });
  }

  private userSelect(selection: Selection): void {
    this.applySelection(selection);
    this.onSelect?.(selection);
  }

  /** Highlights a node by id ('agent', a resource id, or null) without firing onSelect. */
  selectById(value: string | null): Selection {
    let selection: Selection = null;
    if (value === 'agent') {
      selection = { kind: 'agent' };
    } else if (value && this.cards.has(value)) {
      selection = { kind: 'resource', id: value };
    }
    this.applySelection(selection);
    return selection;
  }

  private applySelection(selection: Selection): void {
    this.selection = selection;
    for (const element of this.cards.values()) {
      element.classList.remove('node--selected');
      element.setAttribute('aria-selected', 'false');
    }
    const id =
      selection?.kind === 'agent'
        ? AGENT_ID
        : selection?.kind === 'resource'
          ? selection.id
          : null;
    if (id) {
      const selected = this.cards.get(id);
      selected?.classList.add('node--selected');
      selected?.setAttribute('aria-selected', 'true');
    }
  }

  fit(): void {
    if (!this.layout) {
      return;
    }
    const b = layoutBounds(this.layout);
    this.panzoom.fitToWorldBox({
      minX: ORIGIN + b.minX,
      minY: ORIGIN + b.minY,
      maxX: ORIGIN + b.maxX,
      maxY: ORIGIN + b.maxY
    });
  }

  zoomIn(): void {
    this.panzoom.zoomByCentered(1.2);
  }

  zoomOut(): void {
    this.panzoom.zoomByCentered(1 / 1.2);
  }

  getTransform(): Transform {
    return { ...this.panzoom.transform };
  }

  setTransform(t: Transform): void {
    this.panzoom.setTransform(t);
  }

  getSelection(): Selection {
    return this.selection;
  }
}
