/** Webview entry point: the shared shell that mounts a per-artifact renderer. */
import './styles/reset.css';
import './styles/canvas.css';
import './styles/inspector.css';
import './styles/shell.css';
import './styles/codedApp.css';
import './styles/flow.css';
import './styles/case.css';
import './styles/bpmn.css';
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

window.addEventListener('message', (event: MessageEvent) => {
  // Defense-in-depth: VS Code's webview channel is already sandboxed (the host
  // is the only sender that can postMessage into this iframe), but rejecting
  // events from any other source documents the trust boundary and protects
  // against future host-side changes that broaden the channel.
  if (event.source && event.source !== window.parent && event.source !== window) {
    return;
  }
  const message = event.data as HostToWebview;
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
      }
      break;
  }
});

post({ type: 'ready' });
