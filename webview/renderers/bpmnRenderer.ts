/**
 * The Maestro BPMN renderer — embeds the industry-standard `bpmn-js` Modeler
 * as a {@link Renderer} so it sits alongside the other artifact renderers.
 *
 * The Modeler owns the authoritative BPMN parse, the canvas, pan/zoom, and all
 * direct-manipulation editing. This renderer is the thin adapter between it and
 * the designer shell:
 *
 *  - `mount`     — constructs the Modeler in the shell's main area, registered
 *                  with the UiPath moddle extension so `uipath:*` metadata is
 *                  never dropped on save (see {@link uipathModdleDescriptor}).
 *  - `update`    — imports new XML, with an echo-suppression guard so the
 *                  webview does not re-import its own just-saved edit.
 *  - editing     — listens for `commandStack.changed`, debounces, serializes
 *                  via `saveXML`, and posts a `bpmnSetXml` message to the host.
 *  - zoom / fit  — delegate to the Modeler's own `canvas` service.
 *  - theming     — `bpmn-js` bakes element colours into the SVG at construction
 *                  time, so the Modeler is given a dark or light palette to
 *                  match the active VS Code theme, and is rebuilt if the theme
 *                  is switched while the designer is open. (The `bpmn-js`
 *                  chrome — palette, context pad — is themed separately, in CSS.)
 */
import Modeler from 'bpmn-js/lib/Modeler';
import type { ArtifactModel, MaestroBpmnModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { el } from '../util';
import { uipathModdleDescriptor } from './bpmn/uipathModdle';
import { createTriggerLabelRendererModule } from './bpmn/triggerLabelRenderer';

/** Debounce window (ms) between a canvas change and the XML being posted. */
const SAVE_DEBOUNCE_MS = 300;

/**
 * Element colours handed to the `bpmn-js` renderer. The library writes these
 * into the SVG as literal colour attributes at construction time — CSS custom
 * properties cannot be used there — so each theme is resolved to literals.
 */
interface BpmnThemeColors {
  defaultFillColor: string;
  defaultStrokeColor: string;
  defaultLabelColor: string;
}

type BpmnThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

/** Dark theme: dark shape fills, light outlines and labels. */
const DARK_COLORS: BpmnThemeColors = {
  defaultFillColor: '#2d2d30',
  defaultStrokeColor: '#c5c5c5',
  defaultLabelColor: '#e7e7e7'
};

/** Light theme: the `bpmn-js` stock palette — white fills, near-black ink. */
const LIGHT_COLORS: BpmnThemeColors = {
  defaultFillColor: '#ffffff',
  defaultStrokeColor: '#22242a',
  defaultLabelColor: '#22242a'
};

/** High-contrast dark: maximize contrast for both embedded and external labels. */
const HIGH_CONTRAST_COLORS: BpmnThemeColors = {
  defaultFillColor: '#000000',
  defaultStrokeColor: '#ffffff',
  defaultLabelColor: '#ffffff'
};

/** High-contrast light: keep external labels readable on a light canvas. */
const HIGH_CONTRAST_LIGHT_COLORS: BpmnThemeColors = {
  defaultFillColor: '#ffffff',
  defaultStrokeColor: '#000000',
  defaultLabelColor: '#000000'
};

/**
 * VS Code tags `document.body` with the active color theme kind. Resolve the
 * exact kind because high-contrast-light needs a light diagram palette even
 * though it is not tagged as `vscode-light`.
 */
function themeKind(): BpmnThemeKind {
  const classes = document.body.classList;
  if (classes.contains('vscode-high-contrast-light')) {
    return 'high-contrast-light';
  }
  if (classes.contains('vscode-high-contrast')) {
    return 'high-contrast';
  }
  if (classes.contains('vscode-light')) {
    return 'light';
  }
  return 'dark';
}

/** The element colour palette for the active VS Code theme. */
function themeColors(): BpmnThemeColors {
  switch (themeKind()) {
    case 'light':
      return LIGHT_COLORS;
    case 'high-contrast':
      return HIGH_CONTRAST_COLORS;
    case 'high-contrast-light':
      return HIGH_CONTRAST_LIGHT_COLORS;
    case 'dark':
    default:
      return DARK_COLORS;
  }
}

/** A `diagram-js` canvas viewbox, as returned by `canvas.viewbox()`. */
interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
}

/** The minimal `diagram-js` canvas surface this renderer uses. */
interface BpmnCanvas {
  zoom(newScale?: number | 'fit-viewport', center?: { x: number; y: number } | 'auto'): number;
  viewbox(box?: Viewbox): Viewbox;
}

/** The minimal `diagram-js` event bus surface this renderer uses. */
interface BpmnEventBus {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
}

class BpmnRenderer implements Renderer {
  private host!: RendererHost;
  private modeler: Modeler | null = null;

  /** The host element `bpmn-js` is mounted into; reused across theme rebuilds. */
  private canvasHost: HTMLElement | null = null;

  /**
   * The XML the canvas currently reflects. Set both when we import a model and
   * when we serialize+post an edit. On `update`, a model whose `xml` equals
   * this value is the echo of our own edit — re-importing it would needlessly
   * destroy viewport and selection, so it is skipped.
   */
  private lastSyncedXml: string | null = null;

  /** True once the first model has been imported into the Modeler. */
  private imported = false;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onCommandStackChanged = (): void => this.scheduleSave();

  /** Watches `document.body` so the diagram can follow a VS Code theme switch. */
  private themeObserver: MutationObserver | null = null;
  private currentThemeKind = themeKind();
  private readonly onBodyThemeChanged = (): void => {
    const nextThemeKind = themeKind();
    if (nextThemeKind === this.currentThemeKind) {
      return;
    }
    this.currentThemeKind = nextThemeKind;
    void this.rebuildForTheme();
  };

  public mount(container: HTMLElement, host: RendererHost): void {
    this.host = host;

    this.canvasHost = el('div', { class: 'bpmn-canvas-host' });
    container.append(this.canvasHost);

    this.createModeler();

    // bpmn-js bakes element colours in at construction; watch for a VS Code
    // theme switch so the diagram can be rebuilt to follow it.
    this.themeObserver = new MutationObserver(this.onBodyThemeChanged);
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  /** Constructs the Modeler with the active theme's colours and wires events. */
  private createModeler(): void {
    if (!this.canvasHost) {
      return;
    }
    // `bpmnRenderer` and `additionalModules` are bpmn-js module-config keys —
    // the element colour palette, and a display-only renderer that shows a
    // friendly label for UiPath trigger start events. They are assembled on a
    // plain object (not the constructor literal) so they are not rejected as
    // excess properties of the typed options.
    const colors = themeColors();
    const modelerConfig = {
      container: this.canvasHost,
      bpmnRenderer: colors,
      additionalModules: [createTriggerLabelRendererModule(colors.defaultLabelColor)],
      moddleExtensions: { uipath: uipathModdleDescriptor }
    };
    this.modeler = new Modeler(modelerConfig);

    // Any canvas mutation (add / move / delete / edit) bumps the command stack.
    this.eventBus().on('commandStack.changed', this.onCommandStackChanged);
  }

  public update(model: ArtifactModel): void {
    const bpmnModel = model as MaestroBpmnModel;

    // Echo of our own just-saved edit — the canvas is already current. Skipping
    // the re-import preserves viewport and selection.
    if (this.imported && bpmnModel.xml === this.lastSyncedXml) {
      return;
    }
    void this.importXml(bpmnModel.xml);
  }

  /** Imports XML into the Modeler, restoring the viewport for external edits. */
  private async importXml(xml: string): Promise<void> {
    if (!this.modeler) {
      return;
    }
    // Preserve the viewport across a genuine external re-import (e.g. a git
    // change), but not on the very first import — that one gets a clean fit.
    const previousViewbox = this.imported ? this.safeViewbox() : null;

    try {
      await this.modeler.importXML(xml);
      this.imported = true;
      this.lastSyncedXml = xml;

      if (previousViewbox) {
        this.canvas().viewbox(previousViewbox);
      } else {
        this.fit();
      }
    } catch (e) {
      this.host.post({
        type: 'log',
        level: 'error',
        message: `BPMN import failed: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }

  /**
   * Re-creates the Modeler with the current theme's colours, preserving the
   * diagram XML and viewport. bpmn-js fixes element colours at construction, so
   * a theme switch can only be reflected by a rebuild.
   */
  private async rebuildForTheme(): Promise<void> {
    if (!this.modeler || !this.canvasHost) {
      return;
    }
    const xml = this.lastSyncedXml;
    const viewbox = this.imported ? this.safeViewbox() : null;

    this.teardownModeler();
    this.imported = false;
    this.createModeler();

    if (xml === null || !this.modeler) {
      return;
    }
    try {
      await this.modeler.importXML(xml);
      this.imported = true;
      if (viewbox) {
        this.canvas().viewbox(viewbox);
      } else {
        this.fit();
      }
    } catch (e) {
      this.host.post({
        type: 'log',
        level: 'error',
        message: `BPMN theme rebuild failed: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }

  /** Debounced: serialize the canvas and post the new XML back to the host. */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveAndPost();
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveAndPost(): Promise<void> {
    if (!this.modeler) {
      return;
    }
    try {
      const { xml } = await this.modeler.saveXML({ format: true });
      if (typeof xml !== 'string' || xml.length === 0) {
        return;
      }
      // Nothing actually changed since the last sync — do not churn the file.
      if (xml === this.lastSyncedXml) {
        return;
      }
      // Record before posting so the echoed model is recognized in `update`.
      this.lastSyncedXml = xml;
      this.host.post({ type: 'bpmnSetXml', xml });
    } catch (e) {
      this.host.post({
        type: 'log',
        level: 'error',
        message: `BPMN serialize failed: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }

  // --- bpmn-js service accessors -----------------------------------------

  private canvas(): BpmnCanvas {
    return this.modeler!.get<BpmnCanvas>('canvas');
  }

  private eventBus(): BpmnEventBus {
    return this.modeler!.get<BpmnEventBus>('eventBus');
  }

  /** Reads the current viewbox, returning `null` if the canvas is not ready. */
  private safeViewbox(): Viewbox | null {
    try {
      return this.canvas().viewbox();
    } catch {
      return null;
    }
  }

  /** Detaches events and destroys the Modeler; shared by rebuild and dispose. */
  private teardownModeler(): void {
    if (!this.modeler) {
      return;
    }
    try {
      this.eventBus().off('commandStack.changed', this.onCommandStackChanged);
    } catch {
      /* event bus already gone */
    }
    this.modeler.destroy();
    this.modeler = null;
  }

  // --- Renderer toolbar surface ------------------------------------------

  public fit(): void {
    if (!this.modeler || !this.imported) {
      return;
    }
    try {
      this.canvas().zoom('fit-viewport', 'auto');
      this.host.notifyViewChanged();
    } catch {
      /* canvas not ready */
    }
  }

  public zoomIn(): void {
    this.stepZoom(1.2);
  }

  public zoomOut(): void {
    this.stepZoom(1 / 1.2);
  }

  /** Multiplies the current canvas zoom by `factor`, clamped to a sane range. */
  private stepZoom(factor: number): void {
    if (!this.modeler || !this.imported) {
      return;
    }
    try {
      const canvas = this.canvas();
      const next = Math.min(4, Math.max(0.2, canvas.zoom() * factor));
      canvas.zoom(next);
      this.host.notifyViewChanged();
    } catch {
      /* canvas not ready */
    }
  }

  public getZoom(): number | null {
    if (!this.modeler || !this.imported) {
      return null;
    }
    try {
      return this.canvas().zoom();
    } catch {
      return null;
    }
  }

  public getViewState(): WebviewViewState {
    const box = this.imported ? this.safeViewbox() : null;
    return {
      zoom: box?.scale ?? 1,
      panX: box?.x ?? 0,
      panY: box?.y ?? 0,
      selectedId: null
    };
  }

  public dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    this.teardownModeler();
  }
}

export function createBpmnRenderer(): Renderer {
  return new BpmnRenderer();
}
