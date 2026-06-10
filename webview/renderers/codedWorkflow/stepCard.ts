/**
 * Leaf statement builders for the coded-workflow canvas: tier-1 activity
 * cards, tier-2 pseudo-step cards, tier-3 raw-code chips. Pure DOM builders —
 * no renderer state, no innerHTML (chip code goes through `textContent`).
 */
import type {
  CwActivityCard,
  CwPseudoStep,
  CwRawChip,
  SourceSpan
} from '../../../src/model/codedWorkflow/cwTypes';
import { el } from '../../util';
import { cwIcon } from './cwIcons';

function spanAttr(span: SourceSpan): string {
  return `${span.startLine}:${span.startCol}-${span.endLine}:${span.endCol}`;
}

function applyDataAttrs(node: HTMLElement, id: string, span: SourceSpan, tier: number): void {
  node.dataset.id = id;
  node.dataset.span = spanAttr(span);
  node.dataset.tier = String(tier);
}

/** `label: value` text for one arg, used for the hover title. */
function argText(card: CwActivityCard): string {
  const parts = card.args.map((arg) => `${arg.label}: ${arg.value}`);
  if (card.resultBinding !== undefined) {
    parts.push(`→ ${card.resultBinding}`);
  }
  return parts.join('  ·  ');
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

  if (card.args.length > 0 || card.resultBinding !== undefined) {
    const argLine = el('div', { class: 'cw-card-args', title: argText(card) });
    for (const arg of card.args) {
      argLine.append(
        el('span', { class: `cw-arg cw-arg--${arg.kind}` }, [
          el('span', { class: 'cw-arg-label', text: `${arg.label}: ` }),
          el('span', { class: 'cw-arg-value', text: arg.value })
        ])
      );
    }
    if (card.resultBinding !== undefined) {
      argLine.append(el('span', { class: 'cw-arg cw-arg-result', text: `→ ${card.resultBinding}` }));
    }
    body.append(argLine);
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
    el('span', { class: 'cw-chip-braces', text: '{ }' }),
    el('span', { class: 'cw-chip-count', text: chipLabel(chip) })
  ];

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
