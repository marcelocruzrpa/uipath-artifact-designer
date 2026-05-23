/**
 * The Maestro Case renderer — the stage-graph canvas plus the per-node
 * inspector, wired as a {@link Renderer} so it sits alongside the other
 * artifact renderers.
 */
import type { ArtifactModel, MaestroCaseModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { el } from '../util';
import { CaseCanvas } from './case/caseCanvas';
import { CaseInspector } from './case/caseInspector';

class CaseRenderer implements Renderer {
  private canvas!: CaseCanvas;
  private inspector!: CaseInspector;
  private savedState: WebviewViewState | null = null;
  private currentModel: MaestroCaseModel | null = null;
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

    this.canvas = new CaseCanvas(canvasHost);
    this.inspector = new CaseInspector(inspectorHost, host.post);

    this.canvas.onViewChange = () => host.notifyViewChanged();
    this.canvas.onSelect = (nodeId) => {
      this.currentSelectionId = nodeId;
      this.renderInspector();
      host.notifyViewChanged();
    };
  }

  public update(model: ArtifactModel): void {
    const caseModel = model as MaestroCaseModel;
    this.currentModel = caseModel;
    this.inspector.setModel(caseModel);

    // An echo of an inspector edit — keep the form's focus, skip the re-render.
    if (this.inspector.suppressNextRender) {
      this.inspector.suppressNextRender = false;
      return;
    }

    this.canvas.render(caseModel);

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
    const id = this.currentSelectionId;
    if (id) {
      if (this.currentModel.trigger && this.currentModel.trigger.id === id) {
        this.inspector.showTrigger(this.currentModel.trigger);
        return;
      }
      const stage = this.currentModel.stages.find((s) => s.id === id);
      if (stage) {
        this.inspector.showStage(stage);
        return;
      }
      const stickyNote = this.currentModel.stickyNotes.find((n) => n.id === id);
      if (stickyNote) {
        this.inspector.showStickyNote(stickyNote);
        return;
      }
      const edge = this.currentModel.edges.find((e) => e.id === id);
      if (edge) {
        this.inspector.showEdge(edge);
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
    /* CaseCanvas / CaseInspector hold no global listeners to release. */
  }
}

export function createCaseRenderer(): Renderer {
  return new CaseRenderer();
}
