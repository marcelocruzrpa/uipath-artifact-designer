/**
 * Leaf statement builders for the coded-workflow canvas: tier-1 activity
 * cards, tier-2 pseudo-step cards, tier-3 raw-code chips. Pure DOM builders —
 * no renderer state, no innerHTML (chip code goes through `textContent`).
 */
import type {
  CwActivityCard,
  CwArgSummary,
  CwPseudoStep,
  CwRawChip,
  SourceSpan
} from '../../../src/model/codedWorkflow/cwTypes';
import { el } from '../../util';
import { cwIcon } from './cwIcons';

function spanAttr(span: SourceSpan): string {
  return `${span.startLine}:${span.startCol}-${span.endLine}:${span.endCol}`;
}

/**
 * Allowlist for arg kind class suffixes — mirrors the CwArgSummary `kind` union.
 * An unexpected value collapses to 'unknown' rather than being interpolated verbatim.
 */
const ALLOWED_ARG_KINDS = new Set<string>([
  'literal', 'interpolated', 'identifier', 'target', 'expression'
]);

function safeArgKind(kind: string): string {
  return ALLOWED_ARG_KINDS.has(kind) ? kind : 'unknown';
}

function applyDataAttrs(node: HTMLElement, id: string, span: SourceSpan, tier: number): void {
  node.dataset.id = id;
  node.dataset.span = spanAttr(span);
  node.dataset.tier = String(tier);
}

/** `label: value` text for an arg list (+ optional result), used for hover titles / aria. */
function argText(args: CwArgSummary[], resultBinding: string | undefined): string {
  const parts = args.map((arg) => `${arg.label}: ${arg.value}`);
  if (resultBinding !== undefined) {
    parts.push(`→ ${resultBinding}`);
  }
  return parts.join('  ·  ');
}

/** The `.cw-card-args` line shared by activity and invoke cards. */
function buildArgLine(args: CwArgSummary[], resultBinding: string | undefined): HTMLElement {
  const argLine = el('div', { class: 'cw-card-args', title: argText(args, resultBinding) });
  for (const arg of args) {
    argLine.append(
      el('span', { class: `cw-arg cw-arg--${safeArgKind(arg.kind)}` }, [
        el('span', { class: 'cw-arg-label', text: `${arg.label}: ` }),
        el('span', { class: 'cw-arg-value', text: arg.value })
      ])
    );
  }
  if (resultBinding !== undefined) {
    argLine.append(el('span', { class: 'cw-arg cw-arg-result', text: `→ ${resultBinding}` }));
  }
  return argLine;
}

/** Tier-1 activity card: accent + icon block + title row + optional arg line. */
export function buildActivityCard(card: CwActivityCard): HTMLElement {
  const node = el('div', { class: 'cw-card cw-card--activity' });
  applyDataAttrs(node, card.id, card.span, 1);
  node.dataset.service = card.service;

  const icon = el('div', { class: 'cw-card-icon' });
  icon.append(cwIcon(card.icon));

  const titleRow = el('div', { class: 'cw-card-titlerow' }, [
    el('span', { class: 'cw-card-title', text: card.title, title: card.title }),
    el('span', { class: 'cw-card-service', text: card.serviceDisplayName })
  ]);

  const body = el('div', { class: 'cw-card-body' }, [titleRow]);

  // Concise, textContent-only summary for screen readers: title + service, then
  // the same `label: value` arg line shown visually (so the announcement matches
  // what is on screen). No HTML — pure strings from the model.
  const ariaParts = [card.title, card.serviceDisplayName];
  if (card.args.length > 0 || card.resultBinding !== undefined) {
    ariaParts.push(argText(card.args, card.resultBinding));
  }
  node.setAttribute('aria-label', ariaParts.filter((p) => p.length > 0).join(', '));

  if (card.args.length > 0 || card.resultBinding !== undefined) {
    body.append(buildArgLine(card.args, card.resultBinding));
  }

  // Workflow-invocation activities (`workflows.Foo(...)` / `RunWorkflow("X")`)
  // gain an open affordance: when the target resolves to a file the card carries
  // `data-uri` so a double-click opens the invoked workflow (wired by the
  // renderer), plus a link accent. Selection (single click) is unchanged.
  if (card.invokeKind !== undefined) {
    node.classList.add('cw-card--invoke');
    const target = card.invokeTarget;
    const uri = target?.status === 'resolved' ? target.uri : undefined;
    if (uri !== undefined) {
      node.classList.add('cw-card--link');
      node.dataset.uri = uri;
      node.title = `Open ${target?.relPath ?? card.invokeCallee ?? ''} — double-click`;
    }
  }

  node.append(icon, body);
  return node;
}

/** Tier-2 pseudo-step card: same geometry, fx corner glyph, no service tag. */
export function buildPseudoCard(step: CwPseudoStep): HTMLElement {
  const node = el('div', { class: 'cw-card cw-card--pseudo' });
  applyDataAttrs(node, step.id, step.span, 2);

  const icon = el('div', { class: 'cw-card-icon' });
  icon.append(cwIcon(step.icon));

  const fx = el('span', { class: 'cw-fx', title: 'Recognized code pattern' });
  fx.append(cwIcon('fx'));

  const body = el('div', { class: 'cw-card-body' }, [
    el('div', { class: 'cw-card-titlerow' }, [
      el('span', { class: 'cw-card-title', text: step.title, title: step.title })
    ]),
    el('div', { class: 'cw-card-text', text: step.text, title: step.text })
  ]);

  // Screen-reader summary: the recognized-pattern title plus its short text.
  node.setAttribute(
    'aria-label',
    [step.title, step.text].filter((p) => p.length > 0).join(', ')
  );

  node.append(icon, body, fx);
  return node;
}

function chipLabel(chip: CwRawChip): string {
  return chip.lineCount === 1 ? '1 line of code' : `${chip.lineCount} lines of code`;
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
 * Tier-3 raw-code chip. Collapsed: a one-line grey `{ } N lines of code`
 * toggle. Expanded: the same header plus a <pre> with the exact code.
 */
export function buildChip(
  chip: CwRawChip,
  collapsed: boolean,
  onToggle: (id: string) => void
): HTMLElement {
  const node = el('div', {
    class: `cw-chip ${collapsed ? 'cw-chip--collapsed' : 'cw-chip--expanded'}`
  });
  applyDataAttrs(node, chip.id, chip.span, 3);

  const chevron = el('span', { class: 'cw-chip-chevron' });
  chevron.append(cwIcon(collapsed ? 'chevron-right' : 'chevron-down'));
  const headerChildren: Array<Node | string> = [
    chevron,
    el('span', { class: 'cw-chip-braces', text: '{ }' })
  ];
  // A helper-call chip leads with "Call helper <name>" and carries an in-file
  // jump target (a double-click reveals the Helper section). The honest line
  // count stays as a dim suffix and the raw code still shows when expanded.
  if (chip.helperTarget !== undefined) {
    node.classList.add('cw-chip--helper', 'cw-chip--link');
    node.dataset.target = chip.helperTarget.targetId;
    node.title = `Open helper ${chip.helperTarget.name} — double-click`;
    headerChildren.push(
      el('span', { class: 'cw-chip-helper', text: `Call helper ${chip.helperTarget.name}` })
    );
  }
  headerChildren.push(el('span', { class: 'cw-chip-count', text: chipLabel(chip) }));

  if (collapsed) {
    // The whole chip is the toggle.
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.setAttribute('aria-expanded', 'false');
    node.append(...headerChildren);
    onActivate(node, () => onToggle(chip.id));
    return node;
  }

  const header = el('div', { class: 'cw-chip-header' }, headerChildren);
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  header.setAttribute('aria-expanded', 'true');
  onActivate(header, () => onToggle(chip.id));
  node.append(header);

  const pre = el('pre', { class: 'cw-chip-code' });
  pre.textContent = chip.code;
  node.append(pre);

  if (chip.codeTruncated) {
    node.append(
      el('div', {
        class: 'cw-chip-trunc',
        text: `… truncated (${chip.lineCount} lines total)`
      })
    );
  }
  return node;
}
