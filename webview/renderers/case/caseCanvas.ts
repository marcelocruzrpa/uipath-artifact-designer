/**
 * The Maestro Case stage-graph canvas — an SVG edge layer plus an absolutely
 * positioned DOM node layer, pannable / zoomable via the shared {@link PanZoom}.
 *
 * Built parallel to the Flow canvas, but the Case graph is fully auto-laid-out
 * (dagre, left-to-right) — Case nodes carry no draggable canvas coordinates, so
 * there is no node-drag interaction here.
 */
import type { MaestroCaseModel } from '../../../src/model/types';
import { arrowDirection, nearestInDirection } from '../../canvasNav';
import { PanZoom, type Transform } from '../../interaction';
import { clearChildren, el, svgEl } from '../../util';
import { layoutCase, type CaseGraphLayout } from './caseLayout';
import { createStageCard, createStickyCard, createTriggerCard } from './caseStageCard';

/** Offset applied so all node coordinates stay positive within the world layer. */
const ORIGIN = 4000;
const WORLD_SIZE = 8000;

export class CaseCanvas {
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly edgeLayer: SVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly panzoom: PanZoom;
  private readonly cards = new Map<string, HTMLElement>();

  private layout: CaseGraphLayout | null = null;
  private selectedId: string | null = null;

  /** Fired when the user selects a node (or clears the selection with null). */
  public onSelect: ((nodeId: string | null) => void) | null = null;
  /** Fired when the view (pan / zoom) changes. */
  public onViewChange: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.stage = el('div', { class: 'case-stage' });
    this.world = el('div', { class: 'case-world' });
    this.world.style.width = `${WORLD_SIZE}px`;
    this.world.style.height = `${WORLD_SIZE}px`;
    this.edgeLayer = svgEl('svg', {
      class: 'case-edge-layer',
      width: WORLD_SIZE,
      height: WORLD_SIZE
    });
    this.nodeLayer = el('div', { class: 'case-node-layer' });
    this.world.append(this.edgeLayer, this.nodeLayer);
    this.stage.append(this.world);
    host.append(this.stage);

    this.panzoom = new PanZoom(this.stage, this.world);
    this.panzoom.onChange = () => this.onViewChange?.();

    this.stage.addEventListener('click', (e) => {
      if (this.panzoom.consumeSuppressedClick()) {
        return;
      }
      const card = (e.target as HTMLElement).closest('.case-node') as HTMLElement | null;
      if (card) {
        this.userSelect(card.dataset.nodeId ?? null);
      } else {
        this.userSelect(null);
      }
    });
    this.stage.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('.case-node')) {
        this.fit();
      }
    });
    this.nodeLayer.addEventListener('keydown', this.onNodeKeyDown);
  }

  // --- keyboard navigation ------------------------------------------------

  /**
   * Arrow keys move focus to the nearest node in that direction; Enter / Space
   * select the focused node. Lets keyboard users traverse the stage graph.
   */
  private onNodeKeyDown = (e: KeyboardEvent): void => {
    const card = (e.target as HTMLElement).closest('.case-node') as HTMLElement | null;
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

  /** Renders the full stage graph for a case model. */
  render(model: MaestroCaseModel): void {
    clearChildren(this.edgeLayer);
    clearChildren(this.nodeLayer);
    this.cards.clear();

    this.layout = layoutCase(model.trigger, model.stages, model.stickyNotes, model.edges);

    for (const edge of model.edges) {
      this.drawEdge(edge.source, edge.target);
    }
    if (model.trigger) {
      this.placeCard(model.trigger.id, createTriggerCard(model.trigger));
    }
    for (const stage of model.stages) {
      this.placeCard(stage.id, createStageCard(stage));
    }
    for (const note of model.stickyNotes) {
      this.placeCard(note.id, createStickyCard(note));
    }
    this.applySelection(this.selectedId);
  }

  private placeCard(nodeId: string, card: HTMLElement): void {
    const placed = this.layout?.nodes.get(nodeId);
    if (!placed) {
      return;
    }
    card.style.left = `${ORIGIN + placed.x}px`;
    card.style.top = `${ORIGIN + placed.y}px`;
    card.style.width = `${placed.width}px`;
    this.cards.set(nodeId, card);
    this.nodeLayer.append(card);
  }

  private drawEdge(sourceId: string, targetId: string): void {
    const a = this.layout?.nodes.get(sourceId);
    const b = this.layout?.nodes.get(targetId);
    if (!a || !b) {
      return;
    }
    // Connect the source's right edge to the target's left edge.
    const x1 = ORIGIN + a.x + a.width;
    const y1 = ORIGIN + a.y + a.height / 2;
    const x2 = ORIGIN + b.x;
    const y2 = ORIGIN + b.y + b.height / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    this.edgeLayer.append(svgEl('path', { d, class: 'case-edge' }));
    this.edgeLayer.append(this.arrowHead(x2, y2));
  }

  private arrowHead(x: number, y: number): SVGElement {
    const s = 5;
    return svgEl('path', {
      d: `M ${x} ${y} L ${x - s * 1.6} ${y - s} L ${x - s * 1.6} ${y + s} Z`,
      class: 'case-edge-arrow'
    });
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
      card.classList.toggle('case-node--selected', isSelected);
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
