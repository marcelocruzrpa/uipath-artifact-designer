/**
 * The Coded Workflow renderer — PLACEHOLDER. Renders a plain summary of the
 * model instead of a canvas so the registration sweep (T1.2) is end-to-end
 * testable. The full block-stack canvas (cards, containers, collapse) lands
 * in T1.5.
 */
import type { ArtifactModel, CodedWorkflowModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { clearChildren, el, note } from '../util';

class CodedWorkflowRenderer implements Renderer {
  private container: HTMLElement | null = null;

  public mount(container: HTMLElement, _host: RendererHost): void {
    this.container = container;
  }

  public update(model: ArtifactModel): void {
    if (!this.container) {
      return;
    }
    const cw = model as CodedWorkflowModel;
    clearChildren(this.container);

    const classCount = cw.classes.length;
    const summary =
      classCount === 1 ? '1 workflow class' : `${classCount} workflow classes`;
    this.container.append(
      el('div', { class: 'coded-workflow' }, [
        el('h3', { text: cw.fileName }),
        el('p', { text: `${summary} found in this file.` }),
        note('The coded-workflow canvas is under construction — the full view lands in T1.5.')
      ])
    );
  }

  public fit(): void {
    /* no canvas yet */
  }

  public zoomIn(): void {
    /* no canvas yet */
  }

  public zoomOut(): void {
    /* no canvas yet */
  }

  public getZoom(): number | null {
    return null;
  }

  public getViewState(): WebviewViewState {
    return { zoom: 1, panX: 0, panY: 0, selectedId: null };
  }

  public dispose(): void {
    this.container = null;
  }
}

export function createCodedWorkflowRenderer(): Renderer {
  return new CodedWorkflowRenderer();
}
