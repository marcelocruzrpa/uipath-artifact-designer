/**
 * The Coded Workflow renderer — a read-only, tiered block-stack canvas for a
 * classified C# source file. Tier-1 activity cards, tier-2 pseudo-steps and
 * tier-3 raw-code chips render in source order inside recursive container
 * frames; collapse state is kept as a user-toggle DELTA over host-computed
 * defaults (see collapsePolicy.ts) and persisted via the view state.
 *
 * The renderer posts no edit messages — only `persistViewState`, wired by the
 * shell through `host.notifyViewChanged()` + `getViewState()`.
 */
import type {
  CodedWorkflowModel,
  CwEntryPoint,
  CwStatement,
  CwWorkflowClass
} from '../../src/model/codedWorkflow/cwTypes';
import type { ArtifactModel } from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { clearChildren, deepEqual, el } from '../util';
import { effectiveCollapsed, toggleId } from './codedWorkflow/collapsePolicy';
import { renderStatements, type RenderCtx } from './codedWorkflow/containers';
import { cwIcon } from './codedWorkflow/cwIcons';

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

  public mount(container: HTMLElement, host: RendererHost, savedState: WebviewViewState | null): void {
    this.container = container;
    this.host = host;
    this.userToggled = new Set(savedState?.collapsedIds ?? []);
    this.activeEntry = savedState?.selectedId ?? null;
    if (savedState) {
      this.pendingScroll = { x: savedState.panX, y: savedState.panY };
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

  private render(): void {
    if (!this.container || !this.model) {
      return;
    }
    // Preserve scroll across re-renders; on the first render prefer the
    // persisted view-state position.
    const scroll = this.pendingScroll ?? {
      x: this.scrollEl?.scrollLeft ?? 0,
      y: this.scrollEl?.scrollTop ?? 0
    };
    this.pendingScroll = null;
    clearChildren(this.container);

    const root = el('div', { class: 'cw-root' });
    root.append(this.buildHeader(this.model));

    if (this.model.classes.length === 0) {
      root.append(this.buildEmptyState(this.model));
    } else {
      for (const cls of this.model.classes) {
        root.append(this.buildClassSection(cls, this.model.classes.length > 1));
      }
    }

    root.addEventListener('scroll', this.onScroll);
    this.scrollEl = root;
    this.container.append(root);
    root.scrollLeft = scroll.x;
    root.scrollTop = scroll.y;
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
      const pill = el('span', { class: 'cw-pill cw-pill--partial' });
      pill.append(
        el('span', { class: 'cw-pill-dot' }),
        document.createTextNode('Partial — some code could not be parsed')
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

    return el('div', { class: 'cw-header' }, [
      icon,
      el('div', { class: 'cw-header-text' }, [titleRow, stats])
    ]);
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
      sectionChildren.push(this.buildHelperSection(cls.className, helper.name, helper.body));
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

    body.append(this.buildStatementColumn(entry.body));
    return body;
  }

  private buildStatementColumn(stmts: CwStatement[]): HTMLElement {
    if (stmts.length === 0) {
      return el('div', { class: 'cw-empty', text: '– no statements –' });
    }
    return renderStatements(stmts, this.renderCtx());
  }

  private buildHelperSection(className: string, name: string, stmts: CwStatement[]): HTMLElement {
    const id = helperId(className, name);
    const collapsed = effectiveCollapsed(id, 'container', true, this.userToggled);

    const chevron = el('span', { class: 'cw-ct-chevron' });
    chevron.append(cwIcon(collapsed ? 'chevron-right' : 'chevron-down'));
    const header = el('div', { class: 'cw-helper-header' }, [
      el('span', { class: 'cw-helper-title', text: `Helper: ${name}()` }),
      chevron
    ]);
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.setAttribute('aria-expanded', String(!collapsed));
    onActivate(header, () => this.toggle(id));

    const node = el('div', { class: 'cw-helper' }, [header]);
    node.dataset.id = id;
    if (!collapsed) {
      node.append(el('div', { class: 'cw-helper-body' }, [this.buildStatementColumn(stmts)]));
    }
    return node;
  }

  private renderCtx(): RenderCtx {
    return {
      depth: 0,
      isCollapsed: (id, kind, collapsedByDefault) =>
        effectiveCollapsed(id, kind, collapsedByDefault, this.userToggled),
      onToggle: (id) => this.toggle(id)
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

  // --- Renderer contract --------------------------------------------------------

  public fit(): void {
    this.scrollEl?.scrollTo({ left: 0, top: 0 });
  }

  public zoomIn(): void {
    /* no zoom — block stack scrolls */
  }

  public zoomOut(): void {
    /* no zoom — block stack scrolls */
  }

  public getZoom(): number | null {
    return null;
  }

  public getViewState(): WebviewViewState {
    return {
      zoom: 1,
      panX: this.scrollEl?.scrollLeft ?? 0,
      panY: this.scrollEl?.scrollTop ?? 0,
      selectedId: this.activeEntry,
      collapsedIds: [...this.userToggled]
    };
  }

  public dispose(): void {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.scrollEl?.removeEventListener('scroll', this.onScroll);
    this.scrollEl = null;
    this.container = null;
    this.host = null;
    this.model = null;
    this.lastModel = null;
  }
}

export function createCodedWorkflowRenderer(): Renderer {
  return new CodedWorkflowRenderer();
}
