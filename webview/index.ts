/** Webview entry point: the shared shell that mounts a per-artifact renderer. */
import './styles/reset.css';
import './styles/canvas.css';
import './styles/inspector.css';
import './styles/shell.css';
import './styles/codedApp.css';
import './styles/flow.css';
import './styles/case.css';
import './styles/bpmn.css';
import './styles/codedWorkflow.css';
import './styles/codedGraph.css';
import type { ArtifactModel } from '../src/model/types';
import type {
  FallbackKind,
  HostToWebview,
  WebviewToHost,
  WebviewViewState
} from '../src/util/messages';
import type { Renderer, RendererHost } from './renderer';
import { rendererRegistry } from './rendererRegistry';
import { clearChildren, el } from './util';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

function post(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

function show(node: HTMLElement): void {
  node.classList.remove('hidden');
}

function hide(node: HTMLElement): void {
  node.classList.add('hidden');
}

function toolButton(label: string, title: string, extraClass?: string): HTMLButtonElement {
  return el('button', { class: `tb-btn${extraClass ? ' ' + extraClass : ''}`, text: label, title });
}

function readSavedState(): WebviewViewState | null {
  const raw = vscodeApi.getState();
  if (raw && typeof raw === 'object' && typeof (raw as WebviewViewState).zoom === 'number') {
    return raw as WebviewViewState;
  }
  return null;
}

// --- UI shell -------------------------------------------------------------

const appRoot = document.getElementById('app') as HTMLElement;

const titleEl = el('div', { class: 'toolbar-title', text: 'UiPath Designer' });
const zoomLabel = el('span', { class: 'zoom-label', text: '100%' });
const btnZoomOut = toolButton('−', 'Zoom out');
const btnZoomIn = toolButton('+', 'Zoom in');
const btnFit = toolButton('Fit', 'Fit graph to view');
const btnRaw = toolButton('Raw', 'Open this file as text');

const zoomControls = el('div', { class: 'toolbar-group' }, [
  btnZoomOut,
  zoomLabel,
  btnZoomIn,
  btnFit
]);

const toolbar = el('div', { class: 'toolbar' }, [
  titleEl,
  el('div', { class: 'toolbar-spacer' }),
  el('div', { class: 'toolbar-group' }, [zoomControls, btnRaw])
]);

const diagStrip = el('div', { class: 'diag-strip hidden' });
const errorStrip = el('div', { class: 'error-strip hidden' });
const rendererHost = el('div', { class: 'main' });
const fallbackScreen = el('div', { class: 'fallback-screen hidden' });

appRoot.append(toolbar, diagStrip, errorStrip, rendererHost, fallbackScreen);

// --- State ----------------------------------------------------------------

let renderer: Renderer | null = null;
let rendererKind: string | null = null;

const rendererHostApi: RendererHost = {
  post,
  notifyViewChanged: () => {
    updateZoomLabel();
    persistState();
  }
};

// --- Rendering ------------------------------------------------------------

function updateZoomLabel(): void {
  const zoom = renderer ? renderer.getZoom() : null;
  if (zoom === null || zoom === undefined) {
    hide(zoomControls);
    return;
  }
  show(zoomControls);
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function persistState(): void {
  if (!renderer) {
    return;
  }
  const state = renderer.getViewState();
  vscodeApi.setState(state);
  post({ type: 'persistViewState', state });
}

function renderDiagnostics(model: ArtifactModel): void {
  clearChildren(diagStrip);
  if (model.diagnostics.length === 0) {
    hide(diagStrip);
    return;
  }
  for (const diagnostic of model.diagnostics) {
    diagStrip.append(
      el('div', { class: `diag diag--${diagnostic.severity}`, text: diagnostic.message })
    );
  }
  show(diagStrip);
}

function applyModel(model: ArtifactModel): void {
  hide(fallbackScreen);
  hide(errorStrip);
  show(rendererHost);
  show(toolbar);

  try {
    if (!renderer || rendererKind !== model.kind) {
      if (renderer) {
        renderer.dispose();
      }
      clearChildren(rendererHost);
      renderer = rendererRegistry[model.kind]();
      rendererKind = model.kind;
      // Read state lazily on every mount. A module-level snapshot taken at boot
      // would go stale when the user does Reopen-as-Text → back-to-designer,
      // remounting with state that no longer matches the document on disk.
      renderer.mount(rendererHost, rendererHostApi, readSavedState());
    }

    titleEl.textContent = `${model.title} — ${model.subtitle}`;
    renderer.update(model);
    renderDiagnostics(model);
    updateZoomLabel();
    persistState();
  } catch (e) {
    // A throw inside mount / update used to leave the canvas blank with no
    // hint to the user. Surface the failure so the symptom is at least
    // diagnosable from the designer itself, not just DevTools.
    const message = e instanceof Error ? e.message : String(e);
    // Dispose first so any listeners the renderer attached before the throw
    // are released — otherwise a retry leaves orphaned handlers attached to
    // window or to nodes inside rendererHost. Swallow dispose errors so a
    // secondary throw does not mask the original one in the strip.
    if (renderer) {
      try {
        renderer.dispose();
      } catch {
        /* intentional */
      }
    }
    renderer = null;
    rendererKind = null;
    clearChildren(rendererHost);
    showError(`UiPath Designer: renderer failed — ${message}`);
  }
}

function fallbackTitle(kind: FallbackKind): string {
  switch (kind) {
    case 'artifact':
      return 'Generated build artifact';
    case 'parse-error':
      return 'Could not read this file';
    case 'not-coded-app':
      return 'Not a UiPath Coded App';
    case 'not-flow':
      return 'Not a UiPath Maestro Flow';
    case 'not-bpmn':
      return 'Not a UiPath Maestro BPMN process';
    case 'not-case':
      return 'Not a UiPath Maestro Case';
    case 'not-coded-workflow':
      return 'Not a coded workflow';
    default:
      return 'Not a UiPath low-code agent';
  }
}

function showFallback(kind: FallbackKind, message: string): void {
  hide(rendererHost);
  hide(errorStrip);
  hide(diagStrip);
  hide(zoomControls);
  clearChildren(fallbackScreen);

  const actions = el('div', { class: 'fallback-actions' });
  if (kind === 'artifact') {
    const openBtn = toolButton(
      'Open project agent.json',
      'Open the top-level agent.json',
      'primary'
    );
    openBtn.addEventListener('click', () => post({ type: 'openParentAgent' }));
    actions.append(openBtn);
  }
  const textBtn = toolButton('Reopen as Text', 'Open this file in the text editor');
  textBtn.addEventListener('click', () => post({ type: 'reopenAsText' }));
  actions.append(textBtn);

  fallbackScreen.append(
    el('div', { class: 'fallback-card' }, [
      el('div', { class: 'fallback-title', text: fallbackTitle(kind) }),
      el('p', { class: 'fallback-msg', text: message }),
      actions
    ])
  );
  show(fallbackScreen);
}

function showError(message: string): void {
  clearChildren(errorStrip);
  errorStrip.append(el('div', { class: 'error-text', text: message }));
  show(errorStrip);
}

// --- Wiring ---------------------------------------------------------------

btnZoomIn.addEventListener('click', () => renderer?.zoomIn());
btnZoomOut.addEventListener('click', () => renderer?.zoomOut());
btnFit.addEventListener('click', () => renderer?.fit());
btnRaw.addEventListener('click', () => post({ type: 'reopenAsText' }));

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  if (!renderer) {
    return;
  }
  if (e.key === '+' || e.key === '=') {
    renderer.zoomIn();
  } else if (e.key === '-' || e.key === '_') {
    renderer.zoomOut();
  } else if (e.key === '0') {
    renderer.fit();
  }
});

// --- Host-message watchdog ------------------------------------------------
//
// If the host never delivers `model` / `fallback` / `error`, the canvas
// stays blank forever and the user has no signal as to why. Re-post `ready`
// once after a short delay (handles activation races), then surface a
// visible error if nothing has arrived by the deadline.
let firstHostMessageReceived = false;
let readyRetryTimer: ReturnType<typeof setTimeout> | null = null;
let readyDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

function clearReadyTimers(): void {
  if (readyRetryTimer) {
    clearTimeout(readyRetryTimer);
    readyRetryTimer = null;
  }
  if (readyDeadlineTimer) {
    clearTimeout(readyDeadlineTimer);
    readyDeadlineTimer = null;
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  // VS Code sandboxes the webview iframe, so any postMessage that reaches
  // here can only have been sent by the extension host. Validate by message
  // shape (the discriminated `type` field) instead of `event.source`:
  // different VS Code / Cursor builds proxy host messages through different
  // intermediaries (window.parent, a service-worker frame, etc.), so an
  // identity check on `event.source` silently drops legitimate messages.
  const message = event.data as HostToWebview;
  if (!message || typeof (message as { type?: unknown }).type !== 'string') {
    return;
  }

  firstHostMessageReceived = true;
  clearReadyTimers();

  switch (message.type) {
    case 'model':
      applyModel(message.model);
      break;
    case 'fallback':
      showFallback(message.kind, message.message);
      break;
    case 'error':
      showError(message.message);
      break;
    case 'control':
      if (message.action === 'fitToView') {
        renderer?.fit();
      } else if (message.action === 'showGraph') {
        // No-op for renderers without handleControl; the coded-workflow
        // renderer implements the graph view in T2.3.
        renderer?.handleControl?.('showGraph');
      }
      break;
  }
});

post({ type: 'ready' });

readyRetryTimer = setTimeout(() => {
  if (firstHostMessageReceived) {
    return;
  }
  // Host activation can race the webview's first `ready` post. Re-send once
  // so a slow activation still gets the trigger.
  post({ type: 'ready' });
}, 1200);

readyDeadlineTimer = setTimeout(() => {
  if (firstHostMessageReceived) {
    return;
  }
  showError(
    'UiPath Designer: the extension host did not respond. ' +
      'Try reopening this file as text and back as the designer; ' +
      'if the problem persists, check View → Output → "UiPath Designer".'
  );
}, 5000);
