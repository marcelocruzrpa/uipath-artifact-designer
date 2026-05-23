/**
 * Builds the canvas cards for Maestro Case nodes — trigger, stage,
 * exception-stage and sticky-note. Each is an absolutely-positioned DOM box;
 * the caller positions and sizes it on the canvas node layer.
 */
import type {
  CaseStage,
  CaseStickyNote,
  CaseTrigger
} from '../../../src/model/types';
import { el } from '../../util';

/** Counts the total tasks across every lane of a stage. */
function totalTasks(stage: CaseStage): number {
  return stage.tasks.reduce((sum, lane) => sum + lane.length, 0);
}

/** Appends a small count badge to a row when `count` is positive. */
function badge(label: string, count: number, tone: string): HTMLElement | null {
  if (count <= 0) {
    return null;
  }
  return el('span', { class: `case-badge case-badge--${tone}`, text: `${label} ${count}` });
}

/** Builds the trigger node card. */
export function createTriggerCard(trigger: CaseTrigger): HTMLElement {
  const card = el('div', { class: 'case-node case-node--trigger' });
  card.dataset.caseKind = 'trigger';
  card.dataset.nodeId = trigger.id;
  card.tabIndex = 0;
  card.title = `${trigger.label} — Trigger`;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Trigger: ${trigger.label}`);
  card.setAttribute('aria-selected', 'false');

  card.append(
    el('div', { class: 'case-node-head' }, [
      el('span', { class: 'case-node-glyph', text: '▶' }),
      el('span', { class: 'case-node-tag', text: 'Trigger' })
    ])
  );
  card.append(el('div', { class: 'case-node-label', text: trigger.label, title: trigger.label }));
  if (trigger.serviceType && trigger.serviceType !== 'None') {
    card.append(el('div', { class: 'case-node-sub', text: trigger.serviceType }));
  }
  return card;
}

/** Builds a stage or exception-stage card. */
export function createStageCard(stage: CaseStage): HTMLElement {
  const isException = stage.kind === 'exception-stage';
  const card = el('div', {
    class: `case-node case-node--${isException ? 'exception' : 'stage'}`
  });
  card.dataset.caseKind = isException ? 'exception-stage' : 'stage';
  card.dataset.nodeId = stage.id;
  card.tabIndex = 0;
  card.title = `${stage.label} — ${isException ? 'Exception Stage' : 'Stage'}`;
  card.setAttribute('role', 'button');
  card.setAttribute(
    'aria-label',
    `${isException ? 'Exception Stage' : 'Stage'}: ${stage.label}`
  );
  card.setAttribute('aria-selected', 'false');

  const head = el('div', { class: 'case-node-head' }, [
    el('span', { class: 'case-node-glyph', text: isException ? '⚠' : '▭' }),
    el('span', {
      class: 'case-node-tag',
      text: isException ? 'Exception' : 'Stage'
    })
  ]);
  if (stage.isRequired) {
    head.append(el('span', { class: 'case-node-required', text: 'Required' }));
  }
  card.append(head);

  card.append(el('div', { class: 'case-node-label', text: stage.label, title: stage.label }));
  if (stage.description) {
    card.append(
      el('div', { class: 'case-node-desc', text: stage.description, title: stage.description })
    );
  }

  const badges = el('div', { class: 'case-node-badges' });
  const taskBadge = badge('Tasks', totalTasks(stage), 'task');
  const entryBadge = badge('Entry', stage.entryConditions.length, 'entry');
  const exitBadge = badge('Exit', stage.exitConditions.length, 'exit');
  const slaBadge = badge('SLA', stage.slaRules.length, 'sla');
  for (const b of [taskBadge, entryBadge, exitBadge, slaBadge]) {
    if (b) {
      badges.append(b);
    }
  }
  if (badges.childElementCount > 0) {
    card.append(badges);
  }
  return card;
}

/** Builds a sticky-note card. */
export function createStickyCard(note: CaseStickyNote): HTMLElement {
  const card = el('div', { class: 'case-node case-node--sticky' });
  card.dataset.caseKind = 'sticky-note';
  card.dataset.nodeId = note.id;
  card.dataset.stickyColor = note.color;
  card.tabIndex = 0;
  card.title = note.label;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Sticky note: ${note.label || note.content || 'empty'}`);
  card.setAttribute('aria-selected', 'false');

  card.append(
    el('div', { class: 'case-node-head' }, [
      el('span', { class: 'case-node-glyph', text: '✎' }),
      el('span', { class: 'case-node-tag', text: 'Note' })
    ])
  );
  if (note.label) {
    card.append(el('div', { class: 'case-node-label', text: note.label }));
  }
  if (note.content) {
    card.append(el('div', { class: 'case-node-sticky-body', text: note.content }));
  }
  return card;
}
