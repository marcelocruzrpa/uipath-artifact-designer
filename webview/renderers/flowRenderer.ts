/**
 * The Maestro Flow renderer — the node-graph canvas plus the per-node inspector,
 * wired as a {@link Renderer} so it sits alongside the other artifact renderers.
 */
import type { ArtifactModel, MaestroFlowModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { el } from '../util';
import { FlowCanvas } from './flow/flowCanvas';
import { FlowInspector } from './flow/flowInspector';

class FlowRenderer implements Renderer {
  private canvas!: FlowCanvas;
  private inspector!: FlowInspector;
  private savedState: WebviewViewState | null = null;
  private currentModel: MaestroFlowModel | null = null;
  private currentSelectionId: string | null = null;
  private firstModelApplied = false;

  public mount(
    container: HTMLElement,
    host: RendererHost,
    savedState: WebviewViewState | null
  ): void {
    this.savedState = savedState;

    const canvasHost = el('div', { class: 'canvas-host' });
    const inspectorHost = el('div', { class: 'inspector-host' });
    container.append(canvasHost, inspectorHost);

    this.canvas = new FlowCanvas(canvasHost);
    this.inspector = new FlowInspector(inspectorHost, host.post);

    this.canvas.onViewChange = () => host.notifyViewChanged();
    this.canvas.onSelect = (nodeId) => {
      this.currentSelectionId = nodeId;
      this.renderInspector();
      host.notifyViewChanged();
    };
    this.canvas.onNodeMove = (move) => {
      host.post({ type: 'flowMoveNode', nodeId: move.nodeId, x: move.x, y: move.y });
    };
  }

  public update(model: ArtifactModel): void {
    const flowModel = model as MaestroFlowModel;
    this.currentModel = flowModel;

    // An echo of an inspector edit — keep the form's focus, skip the re-render.
    if (this.inspector.suppressNextRender) {
      this.inspector.suppressNextRender = false;
      return;
    }

    this.canvas.setEdges(flowModel.edges);
    this.canvas.render(flowModel);

    if (!this.firstModelApplied) {
      this.firstModelApplied = true;
      if (this.savedState) {
        this.canvas.setTransform({
          zoom: this.savedState.zoom,
          panX: this.savedState.panX,
          panY: this.savedState.panY
        });
        this.currentSelectionId = this.savedState.selectedId;
      } else {
        this.canvas.fit();
      }
    }

    const applied = this.canvas.selectById(this.currentSelectionId);
    if (!applied) {
      this.currentSelectionId = null;
    }
    this.renderInspector();
  }

  private renderInspector(): void {
    if (!this.currentModel) {
      this.inspector.showEmpty();
      return;
    }
    if (this.currentSelectionId) {
      const node = this.currentModel.nodes.find((n) => n.id === this.currentSelectionId);
      if (node) {
        this.inspector.showNode(node);
        return;
      }
    }
    this.inspector.showOverview(this.currentModel);
  }

  public fit(): void {
    this.canvas.fit();
  }

  public zoomIn(): void {
    this.canvas.zoomIn();
  }

  public zoomOut(): void {
    this.canvas.zoomOut();
  }

  public getZoom(): number | null {
    return this.canvas.getTransform().zoom;
  }

  public getViewState(): WebviewViewState {
    const t = this.canvas.getTransform();
    return { zoom: t.zoom, panX: t.panX, panY: t.panY, selectedId: this.currentSelectionId };
  }

  public dispose(): void {
    /* FlowCanvas / FlowInspector hold no global listeners to release. */
  }
}

export function createFlowRenderer(): Renderer {
  return new FlowRenderer();
}
