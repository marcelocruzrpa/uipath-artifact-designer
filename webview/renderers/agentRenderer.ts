/**
 * The UiPath low-code agent renderer — the node-graph canvas plus inspector
 * that was previously wired directly into the webview entry point. It is now a
 * `Renderer` so it sits alongside the other artifact renderers in the registry.
 */
import type { AgentModel, ArtifactModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import { Canvas, type Selection } from '../canvas';
import { Inspector } from '../inspector';
import type { Renderer, RendererHost } from '../renderer';
import { el } from '../util';

function selectionToId(selection: Selection): string | null {
  if (!selection) {
    return null;
  }
  return selection.kind === 'agent' ? 'agent' : selection.id;
}

class AgentRenderer implements Renderer {
  private canvas!: Canvas;
  private inspector!: Inspector;
  private savedState: WebviewViewState | null = null;
  private currentModel: AgentModel | null = null;
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

    this.canvas = new Canvas(canvasHost);
    this.inspector = new Inspector(inspectorHost, host.post);

    this.canvas.onViewChange = () => host.notifyViewChanged();
    this.canvas.onSelect = (selection) => {
      this.currentSelectionId = selectionToId(selection);
      this.renderInspector();
      host.notifyViewChanged();
    };
  }

  public update(model: ArtifactModel): void {
    const agentModel = model as AgentModel;
    this.currentModel = agentModel;
    this.canvas.render(agentModel);

    if (!this.firstModelApplied) {
      this.firstModelApplied = true;
      if (this.savedState) {
        this.canvas.setTransform({
          zoom: this.savedState.zoom,
          panX: this.savedState.panX,
          panY: this.savedState.panY
        });
        this.currentSelectionId = this.savedState.selectedId ?? 'agent';
      } else {
        this.canvas.fit();
        this.currentSelectionId = 'agent';
      }
    }

    const applied = this.canvas.selectById(this.currentSelectionId);
    if (!applied && this.currentSelectionId !== null) {
      this.currentSelectionId = 'agent';
      this.canvas.selectById('agent');
    }

    this.renderInspector();
  }

  private renderInspector(): void {
    if (!this.currentModel) {
      this.inspector.showEmpty();
      return;
    }
    if (this.currentSelectionId === 'agent') {
      this.inspector.showAgent(this.currentModel);
      return;
    }
    if (this.currentSelectionId) {
      const node = this.currentModel.resources.find((r) => r.id === this.currentSelectionId);
      if (node) {
        this.inspector.showResource(node);
        return;
      }
    }
    this.inspector.showEmpty();
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
    /* Canvas / Inspector hold no global listeners to release. */
  }
}

export function createAgentRenderer(): Renderer {
  return new AgentRenderer();
}
