/**
 * The contract a per-artifact webview renderer satisfies. The shell
 * (`index.ts`) owns the toolbar, diagnostic strips and message plumbing; it
 * mounts exactly one renderer, chosen by `model.kind`, into the main area.
 */
import type { ArtifactModel } from '../src/model/types';
import type { WebviewToHost, WebviewViewState } from '../src/util/messages';

export interface RendererHost {
  /** Sends a message to the extension host. */
  post(message: WebviewToHost): void;
  /** The renderer calls this whenever its zoom / pan / selection changed. */
  notifyViewChanged(): void;
}

export interface Renderer {
  /** Builds the renderer's DOM inside `container`. Called once before update(). */
  mount(container: HTMLElement, host: RendererHost, savedState: WebviewViewState | null): void;
  /** Renders (or re-renders) with a model of this renderer's kind. */
  update(model: ArtifactModel): void;
  /** Toolbar actions — no-ops for renderers without a canvas. */
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Current zoom (1 = 100%), or null when this renderer has no zoom. */
  getZoom(): number | null;
  /** The view state to persist for this document. */
  getViewState(): WebviewViewState;
  /** Releases any listeners. */
  dispose(): void;
}

export type RendererFactory = () => Renderer;
