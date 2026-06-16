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

/** A webview-side slot reference (mirrors edit/editTypes SlotRef). */
export interface SlotIdentity {
  containerId: string;
  methodId: string;
  role?: string;
  roleIndex?: number;
}

/** Per-render context threaded through the recursion. */
export interface RenderCtx {
  /** Nesting depth — drives `data-depth` alternating backgrounds. */
  depth: number;
  /** Resolves the current collapse state of a chip or container. */
  isCollapsed(id: string, kind: 'chip' | 'container', collapsedByDefault: boolean): boolean;
  /** Flips a collapse toggle (the renderer re-renders + persists). */
  onToggle(id: string): void;
  /** Edit mode — when false, no insertion points / handles render. */
  editing: boolean;
  /** Open the palette to insert into a slot at an index. */
  onInsert(slot: SlotIdentity, index: number): void;
  /** Delete a statement by id. */
  onDelete(id: string): void;
  /** Move a statement by id (+1 down / -1 up). */
  onMove(id: string, direction: 1 | -1): void;
  /** The slot identity for the CURRENT statement list (threaded by the caller). */
  slot: SlotIdentity;
}

/** Slot roles that may repeat in one container — they carry a 0-based index. */
const REPEATABLE = new Set(['elseif', 'catch', 'case']);

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

/**
 * Allowlists for model-derived class-name suffixes — defense in depth so an
 * unexpected value collapses to a safe default rather than being interpolated
 * verbatim. Mirror the existing CONTAINER_GLYPHS / icon-map pattern.
 */
const ALLOWED_CONTAINER_KINDS = new Set<string>([
  'if', 'foreach', 'for', 'while', 'do', 'try', 'switch', 'using'
]);
const ALLOWED_BRANCH_ROLES = new Set<string>([
  'then', 'elseif', 'else', 'body', 'try', 'catch', 'finally', 'case', 'default'
]);
const ALLOWED_SECTION_ROLES = ALLOWED_BRANCH_ROLES;

function safeContainerKind(kind: string): string {
  return ALLOWED_CONTAINER_KINDS.has(kind) ? kind : 'unknown';
}
function safeBranchRole(role: string): string {
  return ALLOWED_BRANCH_ROLES.has(role) ? role : 'unknown';
}
function safeSectionRole(role: string): string {
  return ALLOWED_SECTION_ROLES.has(role) ? role : 'unknown';
}

function emptySlotNote(): HTMLElement {
  return el('div', { class: 'cw-empty', text: '– empty –' });
}

/**
 * Builds the vertical statement column. In read-only mode it keeps the connector
 * ticks between cards; in edit mode it replaces them with `+` insertion points
 * (before each statement and after the last) and wraps each statement with
 * delete/up/down handles.
 */
export function renderStatements(stmts: CwStatement[], ctx: RenderCtx): HTMLElement {
  const seq = el('div', { class: 'cw-seq' });
  if (ctx.editing) {
    seq.append(insertionPoint(ctx, 0));
  }
  stmts.forEach((stmt, index) => {
    if (index > 0 && !ctx.editing) {
      seq.append(el('div', { class: 'cw-tick' }));
    }
    seq.append(renderStatement(stmt, ctx));
    if (ctx.editing) {
      seq.append(insertionPoint(ctx, index + 1));
    }
  });
  return seq;
}

/** A `+` button that opens the palette to insert into `ctx.slot` at `index`. */
function insertionPoint(ctx: RenderCtx, index: number): HTMLElement {
  const btn = el('button', { class: 'cw-insert', text: '+', title: 'Insert a step here' });
  btn.type = 'button';
  btn.addEventListener('click', () => ctx.onInsert(ctx.slot, index));
  return btn;
}

function renderStatement(stmt: CwStatement, ctx: RenderCtx): HTMLElement {
  const node = renderBareStatement(stmt, ctx);
  return ctx.editing ? withHandles(node, stmt.id, ctx) : node;
}

function renderBareStatement(stmt: CwStatement, ctx: RenderCtx): HTMLElement {
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

/**
 * Wraps a statement node with move/delete handles (edit mode only). A tier-3
 * chip or container moves/deletes here as a UNIT — Fence F: it is never
 * field-edited, only repositioned or removed.
 */
function withHandles(node: HTMLElement, id: string, ctx: RenderCtx): HTMLElement {
  const wrap = el('div', { class: 'cw-stmt-wrap' }, [node]);
  const handles = el('div', { class: 'cw-stmt-handles' });
  const mk = (cls: string, label: string, title: string, fn: () => void): HTMLElement => {
    const b = el('button', { class: cls, text: label, title });
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  handles.append(
    mk('cw-stmt-up', '↑', 'Move up', () => ctx.onMove(id, -1)),
    mk('cw-stmt-down', '↓', 'Move down', () => ctx.onMove(id, 1)),
    mk('cw-stmt-del', '🗑', 'Delete', () => ctx.onDelete(id))
  );
  wrap.append(handles);
  return wrap;
}

/**
 * Returns a non-interactive note explaining why a block-less slot is read-only,
 * so the user understands the affordance is intentionally absent.
 */
function unbracedNote(): HTMLElement {
  return el('div', { class: 'cw-unbraced-note', text: 'single-statement body — convert to { } to edit' });
}

function slotChildren(slot: CwSlot, ctx: RenderCtx): HTMLElement {
  // A slot with `braced === false` is a block-less single-statement body
  // (e.g. `if (ok) Foo();`).  Agent E rejects inserts into these at the host
  // level; suppress ALL edit affordances here so the user is never offered an
  // action that will be rejected.  Braced slots (braced !== false) keep full
  // affordances.
  if (ctx.editing && slot.braced === false) {
    const unbracedCtx: RenderCtx = { ...ctx, editing: false };
    const seq =
      slot.children.length > 0
        ? renderStatements(slot.children, unbracedCtx)
        : emptySlotNote();
    const wrap = el('div', { class: 'cw-slot-unbraced' }, [seq, unbracedNote()]);
    return wrap;
  }
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
    class: `cw-container cw-container--${safeContainerKind(c.kind)}${collapsed ? ' cw-container--collapsed' : ''}`
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

  // Each child slot gets its OWN ctx whose `slot` identity carries this
  // container's id + the slot role + (for repeatable roles) a 0-based occurrence
  // index. `roleCounts[role] = (roleCounts[role] ?? -1) + 1` yields 0,1,2… per
  // repeatable role — exactly the `elseif0/elseif1`, `catch0/catch1`,
  // `case0/case1` indices `assignIds` assigns (buildModel.ts) — so a SlotRef
  // built here resolves to the same slot host-side. `...ctx` carries
  // editing/onInsert/onDelete/onMove into every nested slot.
  const slotCtx = (role: string, roleIndex?: number): RenderCtx => ({
    ...ctx,
    depth: ctx.depth + 1,
    slot: {
      containerId: c.id,
      methodId: ctx.slot.methodId,
      role,
      ...(roleIndex !== undefined ? { roleIndex } : {})
    }
  });

  if (c.kind === 'if') {
    // Horizontal slot columns: then / else-if… / else.
    const branches = el('div', { class: 'cw-branches' });
    const roleCounts: Record<string, number> = {};
    for (const slot of c.slots) {
      const ri = REPEATABLE.has(slot.role)
        ? (roleCounts[slot.role] = (roleCounts[slot.role] ?? -1) + 1)
        : undefined;
      branches.append(
        el('div', { class: `cw-branch cw-branch--${safeBranchRole(slot.role)}` }, [
          el('div', { class: 'cw-branch-label', text: slot.label }),
          slotChildren(slot, slotCtx(slot.role, ri))
        ])
      );
    }
    node.append(branches);
  } else if (c.kind === 'try' || c.kind === 'switch') {
    // Stacked sections per slot; catch headers warning-tinted, finally muted.
    const roleCounts: Record<string, number> = {};
    for (const slot of c.slots) {
      const ri = REPEATABLE.has(slot.role)
        ? (roleCounts[slot.role] = (roleCounts[slot.role] ?? -1) + 1)
        : undefined;
      node.append(
        el('div', { class: `cw-section cw-section--${safeSectionRole(slot.role)}` }, [
          el('div', { class: 'cw-section-label', text: slot.label }),
          slotChildren(slot, slotCtx(slot.role, ri))
        ])
      );
    }
  } else {
    // foreach / for / while / do / using: a single body column.
    const body = c.slots.find((slot) => slot.role === 'body') ?? c.slots[0];
    node.append(
      el('div', { class: 'cw-ct-body' }, [
        body ? slotChildren(body, slotCtx(body.role)) : emptySlotNote()
      ])
    );
  }

  return node;
}
