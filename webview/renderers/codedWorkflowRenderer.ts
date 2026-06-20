/**
 * The Coded Workflow renderer — a read-only, tiered block-stack canvas for a
 * classified C# source file. Tier-1 activity cards, tier-2 pseudo-steps and
 * tier-3 raw-code chips render in source order inside recursive container
 * frames; collapse state is kept as a user-toggle DELTA over host-computed
 * defaults (see collapsePolicy.ts) and persisted via the view state.
 *
 * The renderer posts no edit messages — only `persistViewState` (wired by the
 * shell through `host.notifyViewChanged()` + `getViewState()`) and, from the
 * call-graph view (T2.3), `openResource` when a graph node is activated.
 *
 * Two modes share this renderer: the file canvas above and the project
 * call-graph view (`codedWorkflow/graphView.ts`), toggled by a segmented
 * control in the header (shown only when `model.graph` is an object).
 */
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwEntryPoint,
  CwHelperMethod,
  CwPseudoStep,
  CwStatement,
  CwWorkflowClass
} from '../../src/model/codedWorkflow/cwTypes';
import type { ArtifactModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import {
  findPaletteItem,
  type PaletteItem
} from '../../src/model/codedWorkflow/edit/editCatalog';
import type { Transform } from '../interaction';
import type { Renderer, RendererHost } from '../renderer';
import { clearChildren, deepEqual, el, note } from '../util';
import { effectiveCollapsed, toggleId } from './codedWorkflow/collapsePolicy';
import {
  renderMethodBody,
  type RenderCtx,
  type SlotIdentity
} from './codedWorkflow/containers';
import { cwIcon } from './codedWorkflow/cwIcons';
import { createGraphView, type GraphView } from './codedWorkflow/graphView';
import { renderPalette } from './codedWorkflow/insertionPalette';
import { renderPropertiesPanel, renderPseudoPanel } from './codedWorkflow/propertiesPanel';

/** A node the dock can inspect: a tier-1 activity card or a tier-2 pseudo-step. */
type SelectableNode = CwActivityCard | CwPseudoStep;

const SCROLL_PERSIST_DELAY_MS = 300;

function entryId(className: string, entryName: string): string {
  return `${className}#${entryName}`;
}

function helperId(className: string, helperName: string): string {
  return `${className}#helper:${helperName}`;
}

function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

/**
 * Splits a `signatureSummary` (`in string a, Dictionary<string, int> b → bool`)
 * into parameter chips + an optional `→ return` chip, honoring nesting so
 * generic-type commas do not split.
 */
function signatureChips(summary: string): string[] {
  let params = summary;
  let returnPart: string | null = null;
  const arrowAt = summary.lastIndexOf('→ ');
  if (arrowAt >= 0) {
    params = summary.slice(0, arrowAt).replace(/\s+$/, '');
    returnPart = summary.slice(arrowAt);
  }
  const chips: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of params) {
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current.trim().length > 0) chips.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    chips.push(current.trim());
  }
  if (returnPart !== null) {
    chips.push(returnPart);
  }
  return chips;
}

function onActivate(node: HTMLElement, handler: () => void): void {
  node.addEventListener('click', handler);
  node.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  });
}

/**
 * Wires the WAI-ARIA keyboard contract onto a `role="tablist"`: a roving
 * tabindex (only the active tab is in the tab order) plus ArrowLeft/ArrowRight
 * (wrapping) and Home/End to move focus between the `role="tab"` children.
 * MANUAL activation — arrows only MOVE focus; the user commits with Enter/Space,
 * which these `<button>` tabs fire natively (running their click handler). Auto-
 * activating on arrow would `render()` the canvas and rebuild the tablist,
 * dropping focus to the document body after a single key. The starting tab in
 * the tab order is the `aria-selected` one, or the first.
 */
function wireTablistKeys(tablist: HTMLElement): void {
  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) {
    return;
  }
  const setRoving = (focusIndex: number): void => {
    tabs.forEach((tab, i) => {
      tab.tabIndex = i === focusIndex ? 0 : -1;
    });
  };
  const activeIndex = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  setRoving(activeIndex >= 0 ? activeIndex : 0);
  tablist.addEventListener('keydown', (event: KeyboardEvent) => {
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      return;
    }
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = tabs.length - 1;
    }
    if (next === null) {
      return;
    }
    // Move focus only (roving tabindex); activation stays manual via Enter/Space.
    event.preventDefault();
    setRoving(next);
    tabs[next]?.focus();
  });
}

/**
 * Depth-first search for the selectable node with `id` — a tier-1 activity card
 * OR a tier-2 pseudo-step (both render as `.cw-card[data-id]` and are dock
 * inspectable) — descending container slots AND a `using` container's
 * `resourceCard` (always an activity, with its own id and `[data-id]` card).
 * Returns null when nothing matches.
 */
function findSelectableNode(stmts: CwStatement[], id: string): SelectableNode | null {
  for (const stmt of stmts) {
    if (stmt.type === 'activity' || stmt.type === 'pseudo') {
      if (stmt.id === id) return stmt;
    } else if (stmt.type === 'container') {
      if (stmt.resourceCard && stmt.resourceCard.id === id) return stmt.resourceCard;
      for (const slot of stmt.slots) {
        const hit = findSelectableNode(slot.children, id);
        if (hit) return hit;
      }
    }
  }
  return null;
}

class CodedWorkflowRenderer implements Renderer {
  private container: HTMLElement | null = null;
  private host: RendererHost | null = null;
  private model: CodedWorkflowModel | null = null;
  private lastModel: CodedWorkflowModel | null = null;
  private userToggled = new Set<string>();
  private activeEntry: string | null = null;
  private scrollEl: HTMLElement | null = null;
  /** Saved scroll to restore after the FIRST render only. */
  private pendingScroll: { x: number; y: number } | null = null;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Requested view mode; the EFFECTIVE mode falls back to canvas without a graph. */
  private mode: 'canvas' | 'graph' = 'canvas';
  private graphView: GraphView | null = null;
  /** In-session stash of the canvas scroll while the graph view is showing. */
  private canvasScrollStash: { x: number; y: number } | null = null;
  /** In-session stash of the graph transform while the canvas is showing. */
  private graphTransformStash: Transform | null = null;
  /** Saved graph transform to restore on the FIRST graph render only. */
  private pendingGraphTransform: Transform | null = null;
  private noteEl: HTMLElement | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The SELECTED activity card for the properties panel — transient (not
   * persisted). Distinct from `activeEntry` (the active entry-POINT tab), which
   * keeps its own meaning in the view state's `selectedId`.
   */
  private selectedNodeId: string | null = null;
  /** Value-editing mode for the panel; read-only is the default. Persisted. */
  private editing = false;
  /** The docked properties-panel region (canvas mode only); re-rendered in place. */
  private dockEl: HTMLElement | null = null;
  /** The transient insertion-palette popover, if open. */
  private popoverEl: HTMLElement | null = null;
  /** Document-level keydown handler closing the popover on Escape, if mounted. */
  private popoverKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** The element focused when the popover opened, to restore focus on close. */
  private popoverOpener: HTMLElement | null = null;

  public mount(container: HTMLElement, host: RendererHost, savedState: WebviewViewState | null): void {
    this.container = container;
    this.host = host;
    this.userToggled = new Set(savedState?.collapsedIds ?? []);
    this.activeEntry = savedState?.selectedId ?? null;
    this.editing = savedState?.editing === true;
    this.mode = savedState?.mode === 'graph' ? 'graph' : 'canvas';
    // The persisted pan/zoom triple belongs to the mode that was ACTIVE at
    // persist time (see getViewState) — route it to the matching sub-view.
    if (savedState) {
      if (savedState.mode === 'graph') {
        this.pendingGraphTransform = {
          zoom: savedState.zoom,
          panX: savedState.panX,
          panY: savedState.panY
        };
      } else {
        this.pendingScroll = { x: savedState.panX, y: savedState.panY };
      }
    }
  }

  public update(model: ArtifactModel): void {
    const cw = model as CodedWorkflowModel;
    if (this.lastModel !== null && deepEqual(this.lastModel, cw)) {
      return; // identical live-reload echo — keep DOM, scroll and focus
    }
    this.lastModel = cw;
    this.model = cw;
    this.render();
  }

  // --- rendering ------------------------------------------------------------

  private hasGraph(): boolean {
    return this.model?.graph !== null && typeof this.model?.graph === 'object';
  }

  /**
   * The mode actually rendered. `mode` is the user's request; without a graph
   * object (null build failure, or a pre-graph lastGood model where `graph`
   * is undefined) the canvas is the only renderable view, so we fall back
   * WITHOUT forgetting the request — if a later model brings the graph back,
   * the user returns to it.
   */
  private effectiveMode(): 'canvas' | 'graph' {
    return this.mode === 'graph' && this.hasGraph() ? 'graph' : 'canvas';
  }

  /**
   * MODE-SWITCH DOM STRATEGY: the two sub-views never share live DOM — the
   * whole `.cw-root` wrapper is rebuilt on every render/switch, hosting
   * EITHER the canvas block-stack OR the graph view. Rebuilding keeps both
   * lifecycles trivial; the deepEqual skip in update() still avoids rebuild
   * churn on identical live-reload echoes, and each view's position is
   * stashed here before teardown so in-session toggles restore it.
   */
  private render(): void {
    if (!this.container || !this.model) {
      return;
    }
    if (this.scrollEl) {
      this.canvasScrollStash = { x: this.scrollEl.scrollLeft, y: this.scrollEl.scrollTop };
      this.scrollEl.removeEventListener('scroll', this.onScroll);
      this.scrollEl.removeEventListener('dblclick', this.onCanvasDblClick);
      this.scrollEl = null;
    }
    // The popover lives in the canvas DOM being torn down — drop it + its
    // document-level Escape listener so it never dangles after a re-render.
    this.closePopover();
    this.dockEl = null;
    if (this.graphView) {
      this.graphTransformStash = this.graphView.getTransform();
      this.graphView.dispose();
      this.graphView = null;
    }
    clearChildren(this.container);

    if (this.effectiveMode() === 'graph') {
      this.renderGraphMode(this.container, this.model);
    } else {
      this.renderCanvasMode(this.container, this.model);
    }
  }

  /**
   * Canvas (block-stack) mode. `.cw-root` is the scroll area (header scrolls
   * with the content, unchanged); it now sits in a `.cw-layout` flex row next
   * to the docked properties panel (`.cw-props-dock`), a NON-scrolling flex
   * sibling so the canvas keeps its own independent scroll.
   */
  private renderCanvasMode(container: HTMLElement, model: CodedWorkflowModel): void {
    // Preserve scroll across re-renders; on the first render prefer the
    // persisted view-state position, then the in-session stash.
    const scroll = this.pendingScroll ?? this.canvasScrollStash ?? { x: 0, y: 0 };
    this.pendingScroll = null;

    const root = el('div', { class: 'cw-root' });
    root.append(this.buildHeader(model));

    if (model.classes.length === 0) {
      root.append(this.buildEmptyState(model));
    } else {
      for (const cls of model.classes) {
        root.append(this.buildClassSection(cls, model.classes.length > 1));
      }
    }

    this.wireCardSelection(root);

    const dock = el('div', { class: 'cw-props-dock' });
    this.dockEl = dock;
    this.renderDock(model);

    const layout = el('div', { class: 'cw-layout' }, [root, dock]);

    root.addEventListener('scroll', this.onScroll);
    root.addEventListener('dblclick', this.onCanvasDblClick);
    this.scrollEl = root;
    container.append(layout);
    root.scrollLeft = scroll.x;
    root.scrollTop = scroll.y;
  }

  /**
   * Makes every inspectable card in the canvas selectable: a click (or Enter /
   * Space) sets `selectedNodeId` and refreshes the dock in place — no canvas
   * rebuild, so scroll and collapse state are untouched. Tier-1 activity cards
   * AND tier-2 pseudo-steps both carry the base `cw-card` class plus `data-id`
   * (see stepCard.ts); chips (`cw-chip`) and containers (`cw-container`) do not,
   * so matching `.cw-card[data-id]` selects exactly the inspectable cards.
   */
  private wireCardSelection(root: HTMLElement): void {
    const cards = root.querySelectorAll<HTMLElement>('.cw-card[data-id]');
    cards.forEach((cardEl) => {
      const id = cardEl.dataset.id;
      if (id === undefined) {
        return;
      }
      cardEl.tabIndex = 0;
      cardEl.setAttribute('role', 'button');
      onActivate(cardEl, () => this.selectCard(id));
    });
    this.applySelectionHighlight(root);
  }

  private selectCard(id: string): void {
    if (this.selectedNodeId === id) {
      return;
    }
    this.selectedNodeId = id;
    if (this.model) {
      this.renderDock(this.model);
    }
    if (this.scrollEl) {
      this.applySelectionHighlight(this.scrollEl);
    }
    this.host?.notifyViewChanged();
  }

  /**
   * Adds `.cw-card--selected` to the selected card, removing it elsewhere, and
   * mirrors that state into `aria-selected` so screen readers announce which
   * inspectable card (tier-1 activity OR tier-2 pseudo-step) is selected. The
   * previously-selected card is set back to `aria-selected="false"`.
   */
  private applySelectionHighlight(root: HTMLElement): void {
    root.querySelectorAll('.cw-card--selected').forEach((n) => n.classList.remove('cw-card--selected'));
    root.querySelectorAll<HTMLElement>('.cw-card[data-id]').forEach((n) => {
      n.setAttribute('aria-selected', 'false');
    });
    if (this.selectedNodeId === null) {
      return;
    }
    const sel = root.querySelector<HTMLElement>(
      `.cw-card[data-id="${CSS.escape(this.selectedNodeId)}"]`
    );
    sel?.classList.add('cw-card--selected');
    sel?.setAttribute('aria-selected', 'true');
  }

  /**
   * (Re)builds the dock contents: the edit-mode toggle plus EITHER the
   * properties panel for the selected card or a hint when nothing is selected.
   */
  private renderDock(model: CodedWorkflowModel): void {
    const dock = this.dockEl;
    if (!dock) {
      return;
    }
    clearChildren(dock);
    dock.append(this.buildEditToggle());

    const node =
      this.selectedNodeId !== null ? this.findSelectedNode(model) : null;
    if (node === null) {
      dock.append(
        el('div', {
          class: 'cw-props-hint',
          text: 'Select a card to see its properties'
        })
      );
      return;
    }
    // A tier-2 pseudo-step (e.g. an Assign card) is a recognized pattern with no
    // editable args — it gets the read-only detail inspector. Tier-1 activity
    // cards get the full (editable) properties panel.
    if (node.type === 'pseudo') {
      dock.append(renderPseudoPanel(node));
      return;
    }
    dock.append(
      renderPropertiesPanel(node, {
        editing: this.editing,
        onEdit: (edit) => {
          this.host?.post({
            type: 'editValue',
            id: edit.id,
            argIndex: edit.argIndex,
            newText: edit.newText
          });
        },
        onArgEdit: (edit) => {
          this.host?.post({
            type: 'editArg',
            id: edit.id,
            op: edit.op,
            ...(edit.argIndex !== undefined ? { argIndex: edit.argIndex } : {}),
            ...(edit.newText !== undefined ? { newText: edit.newText } : {}),
            ...(edit.newMethod !== undefined ? { newMethod: edit.newMethod } : {})
          });
        }
      })
    );
  }

  /** The selected node (activity card or pseudo-step), walking all classes/entries/helpers, or null. */
  private findSelectedNode(model: CodedWorkflowModel): SelectableNode | null {
    if (this.selectedNodeId === null) {
      return null;
    }
    for (const cls of model.classes) {
      for (const ep of cls.entryPoints) {
        const hit = findSelectableNode(ep.body, this.selectedNodeId);
        if (hit) return hit;
      }
      for (const hm of cls.helperMethods) {
        const hit = findSelectableNode(hm.body, this.selectedNodeId);
        if (hit) return hit;
      }
    }
    return null;
  }

  /** The read-only ⇄ edit toggle button shown at the top of the dock. */
  private buildEditToggle(): HTMLElement {
    const btn = el('button', {
      class: `cw-props-toggle${this.editing ? ' cw-props-toggle--on' : ''}`,
      text: this.editing ? 'Editing — click to lock' : 'Read-only — click to edit',
      title: this.editing
        ? 'Values are editable. Click to return to read-only.'
        : 'Values are read-only. Click to enable editing.'
    });
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(this.editing));
    btn.addEventListener('click', () => this.toggleEditing());
    return btn;
  }

  private toggleEditing(): void {
    this.editing = !this.editing;
    // Toggling re-renders the canvas (insertion points / handles appear or
    // vanish), not just the dock — otherwise the affordances would be stale.
    this.closePopover();
    this.render();
    this.host?.notifyViewChanged();
  }

  /**
   * Opens the searchable palette anchored near a clicked insertion point. On
   * pick it resolves the item, collects arg values from a tiny inline form, and
   * posts a STRUCTURED `addStatement` intent — the palette item id plus per-arg
   * values. The HOST emits the C# from the trusted catalog template (and stays
   * the sole mutator + parse-gate), so the webview never hands over finished
   * code for a cataloged insert. Closed on pick or Escape.
   */
  private openInsertPalette(slot: SlotIdentity, index: number): void {
    const popover = renderPalette({
      onPick: (id) => {
        const item = findPaletteItem(id);
        if (item === null) {
          return;
        }
        void this.collectArgValues(item).then((filled) => {
          if (filled === null) {
            return;
          }
          this.host?.post({
            type: 'addStatement',
            slot,
            index,
            paletteItemId: id,
            argValues: filled.values,
            ...(filled.resultBinding !== undefined ? { resultBinding: filled.resultBinding } : {}),
            ...(filled.rawText !== undefined ? { rawText: filled.rawText } : {})
          });
          this.closePopover();
        });
      }
    });
    this.mountPopover(popover);
  }

  /**
   * Renders a small confirm form for a picked palette item: one labeled input
   * per `item.args`, a result-name input when `item.returnsValue`, and a single
   * free-text input for the raw escape (`item.args` empty). Resolves with the
   * filled values on confirm, or null on cancel. No innerHTML.
   */
  private collectArgValues(
    item: PaletteItem
  ): Promise<{ values: string[]; resultBinding?: string; rawText?: string } | null> {
    return new Promise((resolve) => {
      const form = el('div', { class: 'cw-pal-form' });
      form.append(el('div', { class: 'cw-pal-form-title', text: item.label }));

      const isRaw = item.kind === 'raw';
      const inputs: HTMLInputElement[] = [];

      const addField = (labelText: string, placeholder: string | undefined): HTMLInputElement => {
        const input = document.createElement('input');
        input.className = 'cw-props-input';
        input.type = 'text';
        if (placeholder !== undefined) {
          input.placeholder = placeholder;
        }
        form.append(el('label', { class: 'cw-pal-form-label', text: labelText }, [input]));
        return input;
      };

      if (isRaw) {
        inputs.push(addField('C# statement', 'system.DoSomething();'));
      } else {
        for (const arg of item.args) {
          inputs.push(addField(arg.label, arg.placeholder));
        }
      }
      const resultInput =
        !isRaw && item.returnsValue === true ? addField('Result name', 'result') : null;

      const confirm = (): void => {
        const values = inputs.map((i) => i.value);
        resolve({
          values: isRaw ? [] : values,
          ...(resultInput && resultInput.value !== '' ? { resultBinding: resultInput.value } : {}),
          ...(isRaw ? { rawText: values[0] ?? '' } : {})
        });
      };

      const actions = el('div', { class: 'cw-pal-form-actions' });
      const ok = el('button', { class: 'cw-pal-form-ok', text: 'Add' });
      ok.type = 'button';
      ok.addEventListener('click', confirm);
      const cancel = el('button', { class: 'cw-pal-form-cancel', text: 'Cancel' });
      cancel.type = 'button';
      cancel.addEventListener('click', () => resolve(null));
      actions.append(ok, cancel);
      form.append(actions);

      // Replace the palette list with the form inside the open popover.
      if (this.popoverEl) {
        this.popoverEl.replaceChildren(form);
        inputs[0]?.focus();
      } else {
        // No popover mounted (defensive) — surface the form on its own.
        this.mountPopover(form);
      }
    });
  }

  /** Mounts a transient popover into the canvas; Escape closes it. */
  private mountPopover(content: HTMLElement): void {
    this.closePopover();
    // Remember the opener (the clicked insertion point) so focus returns there
    // when the popover closes — otherwise Escape drops focus to document.body.
    const opener = document.activeElement;
    this.popoverOpener = opener instanceof HTMLElement ? opener : null;
    const popover = el('div', { class: 'cw-popover' }, [content]);
    this.popoverEl = popover;
    (this.scrollEl ?? this.container)?.append(popover);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closePopover();
      }
    };
    this.popoverKeydown = onKey;
    document.addEventListener('keydown', onKey);
  }

  private closePopover(): void {
    if (this.popoverKeydown) {
      document.removeEventListener('keydown', this.popoverKeydown);
      this.popoverKeydown = null;
    }
    this.popoverEl?.remove();
    this.popoverEl = null;
    // Restore focus to the opener, but only if it is still in the document
    // (a re-render may have torn it out, in which case there is nothing to focus).
    const opener = this.popoverOpener;
    this.popoverOpener = null;
    if (opener && opener.isConnected) {
      opener.focus();
    }
  }

  /**
   * Graph mode — the SAME header (with the stale/partial pills) stays on
   * top, so parse-health stays visible in both modes; the PanZoom graph view
   * fills the rest.
   */
  private renderGraphMode(container: HTMLElement, model: CodedWorkflowModel): void {
    const root = el('div', { class: 'cw-root cw-root--graph' });
    root.append(el('div', { class: 'cwg-head' }, [this.buildHeader(model)]));
    const body = el('div', { class: 'cwg-body' });
    root.append(body);
    container.append(root);

    const view = createGraphView(body, {
      post: (message) => this.host?.post(message),
      onViewChange: () => this.host?.notifyViewChanged()
    });
    this.graphView = view;
    // hasGraph() guarded the mode, so `graph` is an object here.
    view.update(model.graph!);
    const transform = this.pendingGraphTransform ?? this.graphTransformStash;
    this.pendingGraphTransform = null;
    if (transform) {
      view.setTransform(transform);
    } else {
      view.fit();
    }
  }

  private buildHeader(model: CodedWorkflowModel): HTMLElement {
    const single = model.classes.length === 1 ? model.classes[0] : null;
    const icon = el('span', { class: 'cw-header-icon' });
    icon.append(cwIcon('workflow'));

    const titleRow = el('div', { class: 'cw-header-titlerow' }, [
      el('span', { class: 'cw-header-title', text: single ? single.className : model.fileName })
    ]);
    if (single?.namespace) {
      titleRow.append(el('span', { class: 'cw-header-ns', text: single.namespace }));
    }
    if (model.parseHealth === 'stale') {
      const pill = el('span', {
        class: 'cw-pill cw-pill--stale',
        title: model.staleReason ?? 'The last edit could not be parsed.'
      });
      pill.setAttribute('aria-live', 'polite');
      pill.append(
        el('span', { class: 'cw-pill-dot' }),
        document.createTextNode('Stale — showing last good render')
      );
      titleRow.append(pill);
    } else if (model.parseHealth === 'partial') {
      const errorCount = model.parseErrorCount;
      const pill = el('span', {
        class: 'cw-pill cw-pill--partial',
        title: `${errorCount} ${errorCount === 1 ? 'region' : 'regions'} could not be parsed`
      });
      pill.setAttribute('aria-live', 'polite');
      pill.append(
        el('span', { class: 'cw-pill-dot' }),
        document.createTextNode(
          `Partial — ${errorCount} ${errorCount === 1 ? 'region' : 'regions'} could not be parsed`
        )
      );
      titleRow.append(pill);
    }

    const stats = el('div', {
      class: 'cw-header-stats',
      text: [
        plural(model.stats.tier1, 'activity', 'activities'),
        plural(model.stats.tier2, 'step', 'steps'),
        plural(model.stats.tier3, 'code block', 'code blocks')
      ].join(' · ')
    });

    const header = el('div', { class: 'cw-header' }, [
      icon,
      el('div', { class: 'cw-header-text' }, [titleRow, stats])
    ]);
    if (this.hasGraph()) {
      header.append(this.buildModeTabs());
    }
    return header;
  }

  /** Segmented `Workflow | Call graph` control — built only when a graph exists. */
  private buildModeTabs(): HTMLElement {
    const active = this.effectiveMode();
    const tabs = el('div', { class: 'cwg-mode-tabs' });
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Coded workflow views');
    const entries: Array<['canvas' | 'graph', string, string]> = [
      ['canvas', 'Workflow', 'Show this file as a block-stack canvas'],
      ['graph', 'Call graph', 'Show the project call graph']
    ];
    for (const [mode, label, title] of entries) {
      const tab = el('button', {
        class: `cwg-mode-tab${active === mode ? ' cwg-mode-tab--active' : ''}`,
        text: label,
        title
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active === mode));
      tab.addEventListener('click', () => this.setMode(mode));
      tabs.append(tab);
    }
    wireTablistKeys(tabs);
    return tabs;
  }

  private setMode(mode: 'canvas' | 'graph'): void {
    if (this.mode === mode && this.effectiveMode() === mode) {
      return;
    }
    this.mode = mode;
    this.render();
    this.host?.notifyViewChanged();
  }

  private buildEmptyState(model: CodedWorkflowModel): HTMLElement {
    let message: string;
    if (model.otherClassNames.length > 0) {
      const names = model.otherClassNames.join(', ');
      message =
        model.otherClassNames.length === 1
          ? `${names} is a helper class — no canvas; it appears in the project call graph.`
          : `${names} are helper classes — no canvas; they appear in the project call graph.`;
    } else {
      message = 'No [Workflow] entry point found in this class.';
    }
    return el('div', { class: 'cw-empty-state' }, [
      el('div', { class: 'cw-empty-card', text: message })
    ]);
  }

  private buildClassSection(cls: CwWorkflowClass, showClassHeader: boolean): HTMLElement {
    const sectionChildren: Array<Node | string> = [];

    if (showClassHeader) {
      const head = el('div', { class: 'cw-class-header' }, [
        el('span', { class: 'cw-class-name', text: cls.className })
      ]);
      if (cls.namespace) {
        head.append(el('span', { class: 'cw-header-ns', text: cls.namespace }));
      }
      sectionChildren.push(head);
    }

    if (cls.entryPoints.length === 0) {
      sectionChildren.push(
        el('div', { class: 'cw-empty-card', text: 'No [Workflow] entry point found in this class.' })
      );
    } else {
      const active = this.activeEntryFor(cls);
      if (cls.entryPoints.length > 1) {
        sectionChildren.push(this.buildEntryTabs(cls, active));
      }
      sectionChildren.push(this.buildEntryBody(active));
    }

    for (const helper of cls.helperMethods) {
      sectionChildren.push(this.buildHelperSection(cls.className, helper));
    }

    return el('div', { class: 'cw-class' }, sectionChildren);
  }

  private activeEntryFor(cls: CwWorkflowClass): CwEntryPoint {
    const match = cls.entryPoints.find((e) => entryId(cls.className, e.name) === this.activeEntry);
    return match ?? cls.entryPoints[0];
  }

  private buildEntryTabs(cls: CwWorkflowClass, active: CwEntryPoint): HTMLElement {
    const tabs = el('div', { class: 'cw-tabs' });
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', `${cls.className} entry points`);
    for (const entry of cls.entryPoints) {
      const id = entryId(cls.className, entry.name);
      const tab = el('button', {
        class: `cw-tab${entry === active ? ' cw-tab--active' : ''}`,
        text: entry.name,
        title: `[${entry.attribute}] ${entry.name}`
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(entry === active));
      tab.addEventListener('click', () => {
        if (this.activeEntry === id) {
          return;
        }
        this.activeEntry = id;
        this.render();
        this.host?.notifyViewChanged();
      });
      tabs.append(tab);
    }
    wireTablistKeys(tabs);
    return tabs;
  }

  private buildEntryBody(entry: CwEntryPoint): HTMLElement {
    const body = el('div', { class: 'cw-entry' });

    const head = el('div', { class: 'cw-entry-head' }, [
      el('span', { class: 'cw-entry-name', text: `${entry.name}()` }),
      el('span', { class: 'cw-entry-attr', text: entry.attribute })
    ]);
    body.append(head);

    const chips = signatureChips(entry.signatureSummary);
    if (chips.length > 0) {
      const strip = el('div', { class: 'cw-args-strip' });
      for (const chip of chips) {
        strip.append(
          el('span', {
            class: `cw-sig-chip${chip.startsWith('→') ? ' cw-sig-chip--ret' : ''}`,
            text: chip
          })
        );
      }
      body.append(strip);
    }

    // The entry-point body is a method body: containerId '' + the body's exact
    // id-prefix so a SlotRef resolves host-side (overload/empty-body safe).
    body.append(
      this.buildStatementColumn(
        entry.body,
        this.renderCtx({ containerId: '', methodId: entry.bodyId ?? '' })
      )
    );
    return body;
  }

  private buildStatementColumn(stmts: CwStatement[], ctx: RenderCtx): HTMLElement {
    if (stmts.length === 0) {
      return el('div', { class: 'cw-empty', text: '– no statements –' });
    }
    // Method bodies fold a leading literal-init run into an "Initialization"
    // group (read-only mode); nested slots render via renderStatements directly.
    return renderMethodBody(stmts, ctx);
  }

  private buildHelperSection(className: string, helper: CwHelperMethod): HTMLElement {
    const id = helperId(className, helper.name);
    const collapsed = effectiveCollapsed(id, 'container', true, this.userToggled);

    const chevron = el('span', { class: 'cw-ct-chevron' });
    chevron.append(cwIcon(collapsed ? 'chevron-right' : 'chevron-down'));
    const header = el('div', { class: 'cw-helper-header' }, [
      el('span', { class: 'cw-helper-title', text: `Helper: ${helper.name}()` }),
      chevron
    ]);
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.setAttribute('aria-expanded', String(!collapsed));
    onActivate(header, () => this.toggle(id));

    const node = el('div', { class: 'cw-helper' }, [header]);
    node.dataset.id = id;
    if (!collapsed) {
      // A helper body is a method body too — thread helper.bodyId so an insert /
      // move / delete in a helper resolves host-side (else methodId '' no-ops).
      node.append(
        el('div', { class: 'cw-helper-body' }, [
          this.buildStatementColumn(
            helper.body,
            this.renderCtx({ containerId: '', methodId: helper.bodyId ?? '' })
          )
        ])
      );
    }
    return node;
  }

  private renderCtx(slot: SlotIdentity): RenderCtx {
    return {
      depth: 0,
      isCollapsed: (id, kind, collapsedByDefault) =>
        effectiveCollapsed(id, kind, collapsedByDefault, this.userToggled),
      onToggle: (id) => this.toggle(id),
      editing: this.editing,
      onInsert: (s, index) => this.openInsertPalette(s, index),
      onDelete: (id) => this.host?.post({ type: 'deleteStatement', id }),
      onMove: (id, direction) => this.host?.post({ type: 'moveStatement', id, direction }),
      slot
    };
  }

  // --- interactions -----------------------------------------------------------

  private toggle(id: string): void {
    toggleId(this.userToggled, id);
    this.render();
    // Re-rendering dropped focus with the old DOM — return it to the toggled
    // node so keyboard users keep their place.
    this.restoreFocus(id);
    this.host?.notifyViewChanged();
  }

  private restoreFocus(id: string): void {
    if (!this.scrollEl) {
      return;
    }
    const node = this.scrollEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!node) {
      return;
    }
    if (node.getAttribute('role') === 'button') {
      node.focus();
      return;
    }
    node.querySelector<HTMLElement>('[role="button"]')?.focus();
  }

  private readonly onScroll = (): void => {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
    }
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = null;
      this.host?.notifyViewChanged();
    }, SCROLL_PERSIST_DELAY_MS);
  };

  /**
   * Double-click handling, delegated on the scroll root so it covers any nested
   * container:
   *   - a `.cw-card[data-uri]` (an invoke card with a resolved cross-file target)
   *     → open that workflow in a PERSISTENT designer tab.
   *   - a `.cw-chip[data-target]` (a call to an in-file helper) → reveal +
   *     focus that `Helper:` section.
   * Single click is unchanged (cards select; collapsed chips toggle).
   */
  private readonly onCanvasDblClick = (e: MouseEvent): void => {
    const card = (e.target as HTMLElement).closest('.cw-card[data-uri]') as HTMLElement | null;
    const uri = card?.dataset.uri;
    if (uri !== undefined) {
      this.host?.post({ type: 'openResource', uri, preview: false });
      return;
    }
    const chip = (e.target as HTMLElement).closest('.cw-chip[data-target]') as HTMLElement | null;
    const target = chip?.dataset.target;
    if (target !== undefined) {
      this.revealHelper(target);
    }
  };

  /**
   * Reveal an in-file helper section: expand it if collapsed (its default), then
   * scroll it into view and focus its header. Reuses the collapse delta +
   * effective-collapse policy so the expansion persists like any user toggle.
   */
  private revealHelper(targetId: string): void {
    if (effectiveCollapsed(targetId, 'container', true, this.userToggled)) {
      toggleId(this.userToggled, targetId);
      this.render();
      this.host?.notifyViewChanged();
    }
    const node = this.scrollEl?.querySelector<HTMLElement>(`[data-id="${CSS.escape(targetId)}"]`);
    if (!node) {
      return;
    }
    node.scrollIntoView({ block: 'center' });
    const focusable = node.getAttribute('role') === 'button'
      ? node
      : node.querySelector<HTMLElement>('[role="button"]');
    focusable?.focus();
  }

  // --- Renderer contract --------------------------------------------------------

  /** Host `control` actions — the `UiPath: Show Call Graph` command. */
  public handleControl(action: string): void {
    if (action !== 'showGraph') {
      return;
    }
    if (this.hasGraph()) {
      this.setMode('graph');
      return;
    }
    // No graph to show (null build / pre-graph lastGood model): keep the
    // canvas visible and explain, rather than switching to a blank view.
    if (this.mode !== 'canvas') {
      this.mode = 'canvas';
      this.render();
      this.host?.notifyViewChanged();
    }
    this.showTransientNote('No call graph available for this file');
  }

  private showTransientNote(text: string): void {
    if (!this.container) {
      return;
    }
    this.noteEl?.remove();
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
    }
    const noteEl = note(text);
    noteEl.classList.add('cwg-float-note');
    this.container.append(noteEl);
    this.noteEl = noteEl;
    this.noteTimer = setTimeout(() => {
      noteEl.remove();
      this.noteEl = null;
      this.noteTimer = null;
    }, 4000);
  }

  public fit(): void {
    if (this.graphView) {
      this.graphView.fit();
      return;
    }
    this.scrollEl?.scrollTo({ left: 0, top: 0 });
  }

  public zoomIn(): void {
    // Canvas mode has no zoom — the block stack scrolls.
    this.graphView?.zoomIn();
  }

  public zoomOut(): void {
    this.graphView?.zoomOut();
  }

  public getZoom(): number | null {
    // Real zoom in graph mode (so the shell shows its zoom controls); null on
    // the canvas, which scrolls instead of zooming.
    return this.graphView ? this.graphView.getZoom() : null;
  }

  public getViewState(): WebviewViewState {
    // VIEW-STATE MAPPING: WebviewViewState carries a single pan/zoom triple,
    // which belongs to the ACTIVE mode at persist time (recorded in `mode`):
    //   canvas → panX/panY are the scroll offsets, zoom is 1;
    //   graph  → zoom/panX/panY are the graph PanZoom transform.
    // Persisting BOTH views' positions through this one shape would be
    // overconstrained; the inactive view's position survives in-session via
    // the stashes and falls back to its default (scroll-top / fit) across
    // sessions. selectedId / collapsedIds always keep their canvas meanings.
    const base = {
      selectedId: this.activeEntry,
      collapsedIds: [...this.userToggled],
      // The panel's value-editing mode (read-only by default). Only persisted
      // when on, so a never-edited document keeps `editing` absent.
      ...(this.editing ? { editing: true } : {})
    };
    if (this.graphView) {
      const t = this.graphView.getTransform();
      return { zoom: t.zoom, panX: t.panX, panY: t.panY, mode: 'graph', ...base };
    }
    return {
      zoom: 1,
      panX: this.scrollEl?.scrollLeft ?? 0,
      panY: this.scrollEl?.scrollTop ?? 0,
      mode: 'canvas',
      ...base
    };
  }

  public dispose(): void {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
    this.noteEl = null;
    this.closePopover();
    this.graphView?.dispose();
    this.graphView = null;
    this.canvasScrollStash = null;
    this.graphTransformStash = null;
    this.scrollEl?.removeEventListener('scroll', this.onScroll);
    this.scrollEl?.removeEventListener('dblclick', this.onCanvasDblClick);
    this.scrollEl = null;
    this.dockEl = null;
    this.container = null;
    this.host = null;
    this.model = null;
    this.lastModel = null;
  }
}

export function createCodedWorkflowRenderer(): Renderer {
  return new CodedWorkflowRenderer();
}
