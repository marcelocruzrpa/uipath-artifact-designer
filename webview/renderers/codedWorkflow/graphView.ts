/**
 * The project call-graph view for the coded-workflow editor (T2.3) — an SVG
 * edge layer plus absolutely-positioned HTML node cards inside a {@link
 * PanZoom} stage, cloned from the Maestro Case canvas architecture
 * (`renderers/case/caseCanvas.ts`).
 *
 * Read-only: the only message it posts is `openResource` when a node with a
 * `uri` is activated (click / Enter / Space). Unresolved edges render dashed
 * and are NEVER dropped (R6); unresolved nodes are muted and non-interactive.
 */
import type {
  CodedProjectGraph,
  GraphNodeKind
} from '../../../src/model/codedWorkflow/graph/graphTypes';
import type { WebviewToHost } from '../../../src/util/messages';
import { arrowDirection, nearestInDirection } from '../../canvasNav';
import { PanZoom, type Transform } from '../../interaction';
import { clearChildren, deepEqual, el, svgEl } from '../../util';
import { cwIcon } from './cwIcons';
import {
  layoutGraph,
  type GraphLayoutResult,
  type GraphPoint,
  type PositionedNode,
  type RoutedEdge
} from './graphLayout';

/** Offset applied so all world coordinates stay positive within the world layer. */
const ORIGIN = 4000;
const WORLD_SIZE = 8000;

const STALE_TITLE = 'File has parse errors — edges best-effort';

const UNRESOLVED_TITLES: Record<string, string> = {
  'dynamic-argument': 'Unresolved: the workflow name is a dynamic expression',
  'no-match': 'Unresolved: no matching workflow found in the project',
  ambiguous: 'Unresolved: multiple workflows match this name',
  'target-file-missing': 'Unresolved: the target file is missing'
};

const KIND_ICONS: Record<GraphNodeKind, string> = {
  'coded-workflow': 'workflow',
  'xaml-workflow': 'xaml',
  'helper-class': 'code',
  unresolved: 'unresolved'
};

/**
 * Allowlists for model-derived class-name suffixes — defense in depth so an
 * unexpected value collapses to a safe default rather than being interpolated
 * verbatim. Mirrors the existing KIND_ICONS map pattern.
 */
const ALLOWED_NODE_KINDS = new Set<string>([
  'coded-workflow', 'xaml-workflow', 'helper-class', 'unresolved'
]);
const ALLOWED_EDGE_KINDS = new Set<string>([
  'invoke-workflow', 'run-xaml', 'call-helper'
]);

function safeNodeKind(kind: string): string {
  return ALLOWED_NODE_KINDS.has(kind) ? kind : 'unknown';
}
function safeEdgeKind(kind: string): string {
  return ALLOWED_EDGE_KINDS.has(kind) ? kind : 'unknown';
}

export interface GraphViewOptions {
  post(message: WebviewToHost): void;
  onViewChange(): void;
}

export interface GraphView {
  readonly root: HTMLElement;
  update(graph: CodedProjectGraph): void;
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  getZoom(): number;
  getTransform(): Transform;
  setTransform(t: Transform): void;
  dispose(): void;
}

function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

/** Converts a routed polyline to an SVG path, rounding interior corners. */
function edgePath(points: GraphPoint[]): string {
  const pts = points.map((p) => ({ x: ORIGIN + p.x, y: ORIGIN + p.y }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) {
    return `${d} L ${pts[1].x} ${pts[1].y}`;
  }
  for (let i = 1; i < pts.length - 1; i += 1) {
    const corner = pts[i];
    const next = pts[i + 1];
    const midX = (corner.x + next.x) / 2;
    const midY = (corner.y + next.y) / 2;
    d += ` Q ${corner.x} ${corner.y}, ${midX} ${midY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

class CodedGraphView implements GraphView {
  public readonly root: HTMLElement;

  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly edgeLayer: SVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly statusBar: HTMLElement;
  private readonly panzoom: PanZoom;
  private readonly opts: GraphViewOptions;
  private readonly cards = new Map<string, HTMLElement>();

  private layout: GraphLayoutResult | null = null;
  private lastGraph: CodedProjectGraph | null = null;

  constructor(host: HTMLElement, opts: GraphViewOptions) {
    this.opts = opts;
    this.root = el('div', { class: 'cwg-host' });
    this.stage = el('div', { class: 'cwg-stage' });
    this.world = el('div', { class: 'cwg-world' });
    this.world.style.width = `${WORLD_SIZE}px`;
    this.world.style.height = `${WORLD_SIZE}px`;
    this.edgeLayer = svgEl('svg', {
      class: 'cwg-edge-layer',
      width: WORLD_SIZE,
      height: WORLD_SIZE
    });
    this.nodeLayer = el('div', { class: 'cwg-node-layer' });
    this.statusBar = el('div', { class: 'cwg-status' });
    this.world.append(this.edgeLayer, this.nodeLayer);
    this.stage.append(this.world);
    this.root.append(this.stage, this.statusBar);
    host.append(this.root);

    this.panzoom = new PanZoom(this.stage, this.world);
    this.panzoom.onChange = () => this.opts.onViewChange();

    this.stage.addEventListener('click', this.onStageClick);
    this.stage.addEventListener('dblclick', this.onStageDblClick);
    this.nodeLayer.addEventListener('keydown', this.onNodeKeyDown);
  }

  // --- interactions ---------------------------------------------------------

  private readonly onStageClick = (e: MouseEvent): void => {
    if (this.panzoom.consumeSuppressedClick()) {
      return; // the gesture was a pan, not a click
    }
    const card = (e.target as HTMLElement).closest('.cwg-node') as HTMLElement | null;
    this.openCard(card);
  };

  private readonly onStageDblClick = (e: MouseEvent): void => {
    if (!(e.target as HTMLElement).closest('.cwg-node')) {
      this.fit();
    }
  };

  /**
   * Arrow keys move focus to the nearest focusable card in that direction;
   * Enter / Space open the focused node's file.
   */
  private readonly onNodeKeyDown = (e: KeyboardEvent): void => {
    const card = (e.target as HTMLElement).closest('.cwg-node') as HTMLElement | null;
    if (!card) {
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openCard(card);
      return;
    }
    const direction = arrowDirection(e.key);
    if (!direction) {
      return;
    }
    const focusable = [...this.cards.values()].filter((c) => c.tabIndex === 0);
    const next = nearestInDirection(card, focusable, direction);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  private openCard(card: HTMLElement | null): void {
    const uri = card?.dataset.uri;
    if (uri) {
      this.opts.post({ type: 'openResource', uri });
    }
  }

  // --- rendering --------------------------------------------------------------

  public update(graph: CodedProjectGraph): void {
    if (this.lastGraph !== null && deepEqual(this.lastGraph, graph)) {
      return; // identical graph — keep DOM and focus
    }
    this.lastGraph = graph;
    this.layout = layoutGraph(graph);

    clearChildren(this.edgeLayer);
    clearChildren(this.nodeLayer);
    this.cards.clear();

    this.edgeLayer.append(this.buildArrowDefs());
    for (const routed of this.layout.edges) {
      this.drawEdge(routed);
    }
    for (const placed of this.layout.nodes) {
      this.placeCard(placed);
    }
    this.renderStatus(graph);
  }

  private buildArrowDefs(): SVGElement {
    const defs = svgEl('defs');
    for (const [id, cls] of [
      ['cwg-arrow', 'cwg-arrowhead'],
      ['cwg-arrow-unresolved', 'cwg-arrowhead cwg-arrowhead--unresolved']
    ] as const) {
      const marker = svgEl('marker', {
        id,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse'
      });
      marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: cls }));
      defs.append(marker);
    }
    return defs;
  }

  private drawEdge(routed: RoutedEdge): void {
    const { edge, points } = routed;
    const classes = ['cwg-edge', `cwg-edge--${safeEdgeKind(edge.kind)}`];
    if (!edge.resolved) {
      classes.push('cwg-edge--unresolved');
    }
    const path = svgEl('path', {
      d: edgePath(points),
      class: classes.join(' '),
      'marker-end': `url(#${edge.resolved ? 'cwg-arrow' : 'cwg-arrow-unresolved'})`
    });
    if (!edge.resolved && edge.unresolvedReason) {
      const title = svgEl('title');
      title.textContent =
        UNRESOLVED_TITLES[edge.unresolvedReason] ?? `Unresolved: ${edge.unresolvedReason}`;
      path.append(title);
    }
    this.edgeLayer.append(path);

    if (edge.count > 1) {
      const mid = points[Math.floor(points.length / 2)];
      const label = svgEl('text', {
        x: ORIGIN + mid.x,
        y: ORIGIN + mid.y - 6,
        'text-anchor': 'middle',
        class: 'cwg-edge-count'
      });
      label.textContent = `×${edge.count}`;
      this.edgeLayer.append(label);
    }
  }

  private placeCard(placed: PositionedNode): void {
    const node = placed.node;
    const classes = ['cwg-node', `cwg-node--${safeNodeKind(node.kind)}`];
    if (node.uri) {
      classes.push('cwg-node--link');
    }
    const card = el('div', { class: classes.join(' ') });
    card.dataset.nodeId = node.id;
    card.style.left = `${ORIGIN + placed.x}px`;
    card.style.top = `${ORIGIN + placed.y}px`;
    card.style.width = `${placed.width}px`;
    card.style.minHeight = `${placed.height}px`;

    const icon = el('span', { class: 'cwg-node-icon' });
    icon.append(cwIcon(KIND_ICONS[node.kind]));
    const head = el('div', { class: 'cwg-node-head' }, [
      icon,
      el('span', { class: 'cwg-node-label', text: node.label, title: node.label })
    ]);
    if (node.stale) {
      const dot = el('span', { class: 'cwg-stale-dot', title: STALE_TITLE });
      head.append(dot);
    }
    if (node.isEntryPoint) {
      const pill = el('span', { class: 'cwg-entry-pill', title: 'Project entry point' });
      pill.append(cwIcon('entry'), document.createTextNode('Entry'));
      head.append(pill);
    }
    card.append(head);
    if (node.kind === 'coded-workflow' && node.relPath) {
      card.append(el('div', { class: 'cwg-node-path', text: node.relPath }));
    }

    if (node.uri) {
      // Clickable: opens the file. Unresolved / uri-less nodes stay inert and
      // out of the tab order.
      card.dataset.uri = node.uri;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open ${node.relPath ?? node.label}`);
      card.title = `Open ${node.relPath ?? node.label}`;
    } else if (node.kind === 'unresolved') {
      card.title = 'Unresolved target — no file to open';
    }

    this.cards.set(node.id, card);
    this.nodeLayer.append(card);
  }

  private renderStatus(graph: CodedProjectGraph): void {
    clearChildren(this.statusBar);
    const workflowCount = graph.nodes.filter(
      (n) => n.kind === 'coded-workflow' || n.kind === 'xaml-workflow'
    ).length;
    this.statusBar.append(
      el('span', {
        class: 'cwg-status-text',
        text: `${graph.projectName} · ${plural(workflowCount, 'workflow', 'workflows')} · built in ${
          graph.buildMs ?? 0
        } ms`
      })
    );
    if (graph.truncated) {
      this.statusBar.append(
        el('span', {
          class: 'cwg-status-chip',
          text: 'Graph truncated — showing workflows only'
        })
      );
    }
  }

  // --- view -------------------------------------------------------------------

  public fit(): void {
    if (!this.layout) {
      return;
    }
    this.panzoom.fitToWorldBox({
      minX: ORIGIN,
      minY: ORIGIN,
      maxX: ORIGIN + this.layout.width,
      maxY: ORIGIN + this.layout.height
    });
  }

  public zoomIn(): void {
    this.panzoom.zoomByCentered(1.2);
  }

  public zoomOut(): void {
    this.panzoom.zoomByCentered(1 / 1.2);
  }

  public getZoom(): number {
    return this.panzoom.transform.zoom;
  }

  public getTransform(): Transform {
    return { ...this.panzoom.transform };
  }

  public setTransform(t: Transform): void {
    this.panzoom.setTransform(t);
  }

  public dispose(): void {
    // PanZoom's listeners live on `stage`, which is removed with the root —
    // explicitly detach the layer handlers and drop the subtree.
    this.stage.removeEventListener('click', this.onStageClick);
    this.stage.removeEventListener('dblclick', this.onStageDblClick);
    this.nodeLayer.removeEventListener('keydown', this.onNodeKeyDown);
    this.cards.clear();
    this.lastGraph = null;
    this.layout = null;
    this.root.remove();
  }
}

export function createGraphView(host: HTMLElement, opts: GraphViewOptions): GraphView {
  return new CodedGraphView(host, opts);
}
