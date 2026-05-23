/**
 * The Maestro Flow graph canvas — an SVG edge layer plus an absolutely
 * positioned DOM node layer, pannable / zoomable via the shared {@link PanZoom}.
 *
 * Built parallel to the agent `Canvas`: it does NOT reuse the agent's lane
 * `computeLayout` — flow nodes carry their own coordinates (honored verbatim),
 * with `dagre` filling in only the nodes that lack a stored position.
 */
import type { FlowEdge, FlowNode, MaestroFlowModel } from '../../../src/model/types';
import { arrowDirection, nearestInDirection } from '../../canvasNav';
import { PanZoom, type Transform } from '../../interaction';
import { clearChildren, el, svgEl } from '../../util';
import { createFlowNodeCard } from './flowNodeCard';
import { layoutFlow, type FlowGraphLayout } from './flowLayout';

/** Offset applied so all node coordinates stay positive within the world layer. */
const ORIGIN = 4000;
const WORLD_SIZE = 8000;
/** Pointer travel (px) above which a node press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/** A node drag completed by the user — emitted so the host can persist it. */
export interface NodeMove {
  nodeId: string;
  x: number;
  y: number;
}

export class FlowCanvas {
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly edgeLayer: SVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly panzoom: PanZoom;
  private readonly cards = new Map<string, HTMLElement>();

  private layout: FlowGraphLayout | null = null;
  private selectedId: string | null = null;
  /** The current edge set, recorded so a node drag can repaint cheaply. */
  private lastEdges: FlowEdge[] | null = null;
  /** SVG elements (path + arrowhead) per edge id, for in-place drag updates. */
  private readonly edgeGfx = new Map<string, { path: SVGElement; arrow: SVGElement }>();

  /** Fired when the user selects a node (or clears the selection with null). */
  public onSelect: ((nodeId: string | null) => void) | null = null;
  /** Fired when the view (pan / zoom) changes. */
  public onViewChange: (() => void) | null = null;
  /** Fired when the user finishes dragging a node to a new position. */
  public onNodeMove: ((move: NodeMove) => void) | null = null;

  // --- drag state ---
  private dragId: string | null = null;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  constructor(host: HTMLElement) {
    this.stage = el('div', { class: 'flow-stage' });
    this.world = el('div', { class: 'flow-world' });
    this.world.style.width = `${WORLD_SIZE}px`;
    this.world.style.height = `${WORLD_SIZE}px`;
    this.edgeLayer = svgEl('svg', {
      class: 'flow-edge-layer',
      width: WORLD_SIZE,
      height: WORLD_SIZE
    });
    this.nodeLayer = el('div', { class: 'flow-node-layer' });
    this.world.append(this.edgeLayer, this.nodeLayer);
    this.stage.append(this.world);
    host.append(this.stage);

    this.panzoom = new PanZoom(this.stage, this.world);
    this.panzoom.onChange = () => this.onViewChange?.();

    this.stage.addEventListener('click', (e) => {
      if (this.panzoom.consumeSuppressedClick()) {
        return;
      }
      if (!(e.target as HTMLElement).closest('.flow-node')) {
        this.userSelect(null);
      }
    });
    this.stage.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('.flow-node')) {
        this.fit();
      }
    });

    this.nodeLayer.addEventListener('pointerdown', this.onNodePointerDown);
    this.nodeLayer.addEventListener('pointermove', this.onNodePointerMove);
    this.nodeLayer.addEventListener('pointerup', this.onNodePointerUp);
    this.nodeLayer.addEventListener('pointercancel', this.onNodePointerUp);
    this.nodeLayer.addEventListener('keydown', this.onNodeKeyDown);
  }

  /** Renders the full graph for a flow model. */
  render(model: MaestroFlowModel): void {
    clearChildren(this.edgeLayer);
    clearChildren(this.nodeLayer);
    this.cards.clear();
    this.edgeGfx.clear();

    this.layout = layoutFlow(model.nodes, model.edges);

    for (const edge of model.edges) {
      this.drawEdge(edge);
    }
    for (const node of model.nodes) {
      this.drawNode(node);
    }
    this.applySelection(this.selectedId);
  }

  private drawNode(node: FlowNode): void {
    const placed = this.layout?.nodes.get(node.id);
    if (!placed) {
      return;
    }
    const card = createFlowNodeCard(node);
    card.style.left = `${ORIGIN + placed.x}px`;
    card.style.top = `${ORIGIN + placed.y}px`;
    card.style.width = `${placed.width}px`;
    this.cards.set(node.id, card);
    this.nodeLayer.append(card);
  }

  /**
   * Computes the cubic-bezier `d` path string and the arrowhead tip for an
   * edge, or null when either endpoint is missing from the layout.
   */
  private edgeGeometry(edge: FlowEdge): { d: string; tipX: number; tipY: number } | null {
    const a = this.layout?.nodes.get(edge.sourceNodeId);
    const b = this.layout?.nodes.get(edge.targetNodeId);
    if (!a || !b) {
      return null;
    }
    // Connect the source's right edge to the target's left edge.
    const x1 = ORIGIN + a.x + a.width;
    const y1 = ORIGIN + a.y + a.height / 2;
    const x2 = ORIGIN + b.x;
    const y2 = ORIGIN + b.y + b.height / 2;
    const dx = Math.max(36, Math.abs(x2 - x1) / 2);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    return { d, tipX: x2, tipY: y2 };
  }

  private drawEdge(edge: FlowEdge): void {
    const geo = this.edgeGeometry(edge);
    if (!geo) {
      return;
    }
    const path = svgEl('path', { d: geo.d, class: 'flow-edge' });
    const arrow = this.arrowHead(geo.tipX, geo.tipY);
    this.edgeLayer.append(path);
    this.edgeLayer.append(arrow);
    this.edgeGfx.set(edge.id, { path, arrow });
  }

  /** Updates an existing edge's path + arrowhead in place, no DOM rebuild. */
  private updateEdge(edge: FlowEdge): void {
    const gfx = this.edgeGfx.get(edge.id);
    const geo = this.edgeGeometry(edge);
    if (!gfx || !geo) {
      return;
    }
    gfx.path.setAttribute('d', geo.d);
    const s = 5;
    gfx.arrow.setAttribute(
      'd',
      `M ${geo.tipX} ${geo.tipY} L ${geo.tipX - s * 1.6} ${geo.tipY - s} ` +
        `L ${geo.tipX - s * 1.6} ${geo.tipY + s} Z`
    );
  }

  private arrowHead(x: number, y: number): SVGElement {
    const s = 5;
    return svgEl('path', {
      d: `M ${x} ${y} L ${x - s * 1.6} ${y - s} L ${x - s * 1.6} ${y + s} Z`,
      class: 'flow-edge-arrow'
    });
  }

  // --- node drag ----------------------------------------------------------

  private onNodePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) {
      return;
    }
    const card = (e.target as HTMLElement).closest('.flow-node') as HTMLElement | null;
    if (!card) {
      return;
    }
    const nodeId = card.dataset.nodeId ?? null;
    const placed = nodeId ? this.layout?.nodes.get(nodeId) : undefined;
    if (!nodeId || !placed) {
      return;
    }
    e.stopPropagation();
    this.dragId = nodeId;
    this.dragMoved = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragOriginX = placed.x;
    this.dragOriginY = placed.y;
    card.setPointerCapture(e.pointerId);
    card.classList.add('flow-node--dragging');
  };

  private onNodePointerMove = (e: PointerEvent): void => {
    if (!this.dragId) {
      return;
    }
    const placed = this.layout?.nodes.get(this.dragId);
    const card = this.cards.get(this.dragId);
    if (!placed || !card) {
      return;
    }
    const zoom = this.panzoom.transform.zoom || 1;
    const dx = (e.clientX - this.dragStartX) / zoom;
    const dy = (e.clientY - this.dragStartY) / zoom;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      this.dragMoved = true;
    }
    placed.x = this.dragOriginX + dx;
    placed.y = this.dragOriginY + dy;
    card.style.left = `${ORIGIN + placed.x}px`;
    card.style.top = `${ORIGIN + placed.y}px`;
    this.updateConnectedEdges(this.dragId);
  };

  private onNodePointerUp = (e: PointerEvent): void => {
    if (!this.dragId) {
      return;
    }
    const nodeId = this.dragId;
    const placed = this.layout?.nodes.get(nodeId);
    const card = this.cards.get(nodeId);
    this.dragId = null;
    if (card) {
      try {
        card.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already released */
      }
      card.classList.remove('flow-node--dragging');
    }
    if (this.dragMoved && placed) {
      this.onNodeMove?.({ nodeId, x: placed.x, y: placed.y });
    } else {
      this.userSelect(nodeId);
    }
    this.dragMoved = false;
  };

  // --- keyboard navigation ------------------------------------------------

  /**
   * Arrow keys move focus to the nearest node in that direction; Enter / Space
   * select the focused node. Lets keyboard users traverse the graph.
   */
  private onNodeKeyDown = (e: KeyboardEvent): void => {
    const card = (e.target as HTMLElement).closest('.flow-node') as HTMLElement | null;
    if (!card) {
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.userSelect(card.dataset.nodeId ?? null);
      return;
    }
    const direction = arrowDirection(e.key);
    if (!direction) {
      return;
    }
    const next = nearestInDirection(card, this.cards.values(), direction);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  /**
   * Updates — in place — only the edges touching `nodeId`. Used during a node
   * drag so the ~60/s `pointermove` stream never rebuilds the whole edge layer;
   * unrelated edge paths are left untouched in the DOM.
   */
  private updateConnectedEdges(nodeId: string): void {
    if (!this.lastEdges) {
      return;
    }
    for (const edge of this.lastEdges) {
      if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
        this.updateEdge(edge);
      }
    }
  }

  /** Records the current edge set so a drag can repaint without a full render. */
  setEdges(edges: FlowEdge[]): void {
    this.lastEdges = edges;
  }

  // --- selection ----------------------------------------------------------

  private userSelect(nodeId: string | null): void {
    this.applySelection(nodeId);
    this.onSelect?.(nodeId);
  }

  /** Highlights a node by id without firing {@link onSelect}. */
  selectById(nodeId: string | null): boolean {
    const exists = nodeId !== null && this.cards.has(nodeId);
    this.applySelection(exists ? nodeId : null);
    return exists;
  }

  private applySelection(nodeId: string | null): void {
    this.selectedId = nodeId && this.cards.has(nodeId) ? nodeId : null;
    for (const [id, card] of this.cards) {
      const isSelected = id === this.selectedId;
      card.classList.toggle('flow-node--selected', isSelected);
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  getSelection(): string | null {
    return this.selectedId;
  }

  // --- view ---------------------------------------------------------------

  fit(): void {
    if (!this.layout) {
      return;
    }
    const b = this.layout.bounds;
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
}
