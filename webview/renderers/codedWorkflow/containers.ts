/**
 * Container builders for the coded-workflow canvas — the recursive part of
 * the statement renderer. `renderStatements` lays out a statement column
 * (with connector ticks); `buildContainer` frames if / loop / try / switch /
 * using blocks and recurses into their slots.
 */
import type {
  CwContainer,
  CwContainerKind,
  CwSlot,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';
import { el } from '../../util';
import { cwIcon } from './cwIcons';
import { buildActivityCard, buildChip, buildPseudoCard } from './stepCard';

/** Per-render context threaded through the recursion. */
export interface RenderCtx {
  /** Nesting depth — drives `data-depth` alternating backgrounds. */
  depth: number;
  /** Resolves the current collapse state of a chip or container. */
  isCollapsed(id: string, kind: 'chip' | 'container', collapsedByDefault: boolean): boolean;
  /** Flips a collapse toggle (the renderer re-renders + persists). */
  onToggle(id: string): void;
}

const CONTAINER_GLYPHS: Record<CwContainerKind, string> = {
  if: 'if',
  foreach: 'loop',
  for: 'loop',
  while: 'loop',
  do: 'loop',
  try: 'try',
  switch: 'switch',
  using: 'using'
};

function emptySlotNote(): HTMLElement {
  return el('div', { class: 'cw-empty', text: '– empty –' });
}

/** Builds the vertical statement column with connector ticks between cards. */
export function renderStatements(stmts: CwStatement[], ctx: RenderCtx): HTMLElement {
  const seq = el('div', { class: 'cw-seq' });
  stmts.forEach((stmt, index) => {
    if (index > 0) {
      seq.append(el('div', { class: 'cw-tick' }));
    }
    seq.append(renderStatement(stmt, ctx));
  });
  return seq;
}

function renderStatement(stmt: CwStatement, ctx: RenderCtx): HTMLElement {
  switch (stmt.type) {
    case 'activity':
      return buildActivityCard(stmt);
    case 'pseudo':
      return buildPseudoCard(stmt);
    case 'raw':
      return buildChip(stmt, ctx.isCollapsed(stmt.id, 'chip', true), ctx.onToggle);
    case 'container':
      return buildContainer(stmt, ctx);
  }
}

function slotChildren(slot: CwSlot, ctx: RenderCtx): HTMLElement {
  return slot.children.length > 0 ? renderStatements(slot.children, ctx) : emptySlotNote();
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

/** Builds one container frame (header + slot layout), recursing via `ctx`. */
export function buildContainer(c: CwContainer, ctx: RenderCtx): HTMLElement {
  const collapsed = ctx.isCollapsed(c.id, 'container', c.collapsedByDefault);
  const node = el('div', {
    class: `cw-container cw-container--${c.kind}${collapsed ? ' cw-container--collapsed' : ''}`
  });
  node.dataset.id = c.id;
  node.dataset.kind = c.kind;
  node.dataset.depth = String(ctx.depth);
  node.dataset.span = `${c.span.startLine}:${c.span.startCol}-${c.span.endLine}:${c.span.endCol}`;

  // --- header row (the collapse toggle) ------------------------------------
  const glyph = el('span', { class: 'cw-ct-glyph' });
  glyph.append(cwIcon(CONTAINER_GLYPHS[c.kind]));
  const chevron = el('span', { class: 'cw-ct-chevron' });
  chevron.append(cwIcon(collapsed ? 'chevron-right' : 'chevron-down'));

  const header = el('div', { class: 'cw-ct-header' }, [
    glyph,
    el('span', { class: 'cw-ct-title', text: c.header, title: c.header }),
    el('span', {
      class: 'cw-ct-lines',
      text: `L${c.span.startLine + 1}–${c.span.endLine + 1}`
    }),
    chevron
  ]);
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  header.setAttribute('aria-expanded', String(!collapsed));
  onActivate(header, () => ctx.onToggle(c.id));

  // `using` renders its resource activity card inside the header area, below
  // the header text, so the acquired resource stays visible as part of the
  // container's "signature".
  const head = el('div', { class: 'cw-ct-head' }, [header]);
  if (c.kind === 'using' && c.resourceCard) {
    head.append(el('div', { class: 'cw-ct-resource' }, [buildActivityCard(c.resourceCard)]));
  }
  node.append(head);

  if (collapsed) {
    return node;
  }

  const childCtx: RenderCtx = { ...ctx, depth: ctx.depth + 1 };

  if (c.kind === 'if') {
    // Horizontal slot columns: then / else-if… / else.
    const branches = el('div', { class: 'cw-branches' });
    for (const slot of c.slots) {
      branches.append(
        el('div', { class: `cw-branch cw-branch--${slot.role}` }, [
          el('div', { class: 'cw-branch-label', text: slot.label }),
          slotChildren(slot, childCtx)
        ])
      );
    }
    node.append(branches);
  } else if (c.kind === 'try' || c.kind === 'switch') {
    // Stacked sections per slot; catch headers warning-tinted, finally muted.
    for (const slot of c.slots) {
      node.append(
        el('div', { class: `cw-section cw-section--${slot.role}` }, [
          el('div', { class: 'cw-section-label', text: slot.label }),
          slotChildren(slot, childCtx)
        ])
      );
    }
  } else {
    // foreach / for / while / do / using: a single body column.
    const body = c.slots.find((slot) => slot.role === 'body') ?? c.slots[0];
    node.append(
      el('div', { class: 'cw-ct-body' }, [body ? slotChildren(body, childCtx) : emptySlotNote()])
    );
  }

  return node;
}
