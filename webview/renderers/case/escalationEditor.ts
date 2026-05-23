/**
 * The **escalation editor** widget — edits the `escalationRule[]` list nested
 * inside one SLA rule.
 *
 * It is a sub-widget of {@link SlaEditor}: it mutates the SLA rule's working
 * `escalationRule` array in place and delegates persistence to the parent's
 * `commit` callback (which posts the whole `slaRules[]` collection). It owns
 * only its own build → rebuild lifecycle for the escalation / recipient lists.
 */
import type { SlaEscalation, SlaRuleEntry } from '../../../src/model/types';
import { clearChildren, el } from '../../util';
import { genId, labeledControl, makeInput, makeSelect } from './caseControls';

/** Escalation trigger types. */
const ESC_TRIGGER_TYPES = ['at-risk', 'sla-breached'];

/** Recipient scopes. */
const RECIPIENT_SCOPES = ['User', 'UserGroup'];

export class EscalationEditor {
  private readonly rule: SlaRuleEntry;
  private readonly commit: () => void;

  /**
   * @param rule   the working SLA rule whose `escalationRule[]` is edited
   * @param commit posts the parent SLA collection back to the host
   */
  constructor(rule: SlaRuleEntry, commit: () => void) {
    this.rule = rule;
    this.commit = commit;
  }

  /** Builds the escalation list for the SLA rule. */
  build(): HTMLElement {
    const wrap = el('div', { class: 'case-esc-block' });
    wrap.append(el('div', { class: 'case-rule-head', text: 'Escalations' }));

    const listHost = el('div', { class: 'case-esc-list' });
    const rebuild = (): void => {
      clearChildren(listHost);
      this.rule.escalationRule.forEach((escalation, index) => {
        listHost.append(this.buildEscalationCard(escalation, index, rebuild));
      });
    };
    rebuild();

    const addButton = el('button', { class: 'case-btn-sm', text: '+ Add escalation' });
    addButton.addEventListener('click', () => {
      this.rule.escalationRule.push({
        id: genId('esc_', 6),
        triggerType: 'sla-breached',
        recipients: [],
        raw: {}
      });
      rebuild();
      this.commit();
    });

    wrap.append(listHost, addButton);
    return wrap;
  }

  /** Builds a card for one escalation rule. */
  private buildEscalationCard(
    escalation: SlaEscalation,
    index: number,
    rebuild: () => void
  ): HTMLElement {
    const card = el('div', { class: 'case-esc-card' });

    const head = el('div', { class: 'case-esc-head' });
    const nameInput = makeInput(escalation.displayName ?? '', 'Escalation name', 'case-input');
    nameInput.addEventListener('change', () => {
      escalation.displayName = nameInput.value.trim() || undefined;
      this.commit();
    });
    const removeBtn = el('button', { class: 'case-icon-btn', text: '✕', title: 'Remove escalation' });
    removeBtn.addEventListener('click', () => {
      this.rule.escalationRule.splice(index, 1);
      rebuild();
      this.commit();
    });
    head.append(nameInput, removeBtn);
    card.append(head);

    // Trigger type + at-risk percentage.
    const triggerSelect = makeSelect(ESC_TRIGGER_TYPES, escalation.triggerType, 'case-select');
    const pctInput = el('input', { class: 'case-input case-input--num' });
    pctInput.type = 'number';
    pctInput.min = '1';
    pctInput.max = '99';
    pctInput.placeholder = '%';
    pctInput.value = escalation.atRiskPercentage !== undefined
      ? String(escalation.atRiskPercentage)
      : '';
    const syncPct = (): void => {
      pctInput.classList.toggle('hidden', triggerSelect.value !== 'at-risk');
    };
    syncPct();
    triggerSelect.addEventListener('change', () => {
      escalation.triggerType = triggerSelect.value;
      if (triggerSelect.value !== 'at-risk') {
        escalation.atRiskPercentage = undefined;
      }
      syncPct();
      this.commit();
    });
    pctInput.addEventListener('change', () => {
      const parsed = Number(pctInput.value);
      escalation.atRiskPercentage =
        pctInput.value.trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined;
      this.commit();
    });
    card.append(
      labeledControl('Trigger', el('div', { class: 'case-row' }, [triggerSelect, pctInput]))
    );

    // Recipients.
    card.append(this.buildRecipientList(escalation));
    return card;
  }

  /** Builds the recipient list for one escalation. */
  private buildRecipientList(escalation: SlaEscalation): HTMLElement {
    const wrap = el('div', { class: 'case-recip-block' });
    wrap.append(el('div', { class: 'case-rule-head', text: 'Recipients' }));

    const listHost = el('div', { class: 'case-recip-list' });
    const rebuild = (): void => {
      clearChildren(listHost);
      escalation.recipients.forEach((recipient, index) => {
        const row = el('div', { class: 'case-recip-row' });
        const scopeSelect = makeSelect(RECIPIENT_SCOPES, recipient.scope, 'case-select');
        scopeSelect.addEventListener('change', () => {
          recipient.scope = scopeSelect.value;
          this.commit();
        });
        const valueInput = makeInput(recipient.value, 'email or group name', 'case-input');
        valueInput.addEventListener('change', () => {
          recipient.value = valueInput.value.trim();
          this.commit();
        });
        const targetInput = makeInput(recipient.target, 'user / group UUID', 'case-input');
        targetInput.addEventListener('change', () => {
          recipient.target = targetInput.value.trim();
          this.commit();
        });
        const removeBtn = el('button', {
          class: 'case-icon-btn',
          text: '✕',
          title: 'Remove recipient'
        });
        removeBtn.addEventListener('click', () => {
          escalation.recipients.splice(index, 1);
          rebuild();
          this.commit();
        });
        row.append(scopeSelect, valueInput, targetInput, removeBtn);
        listHost.append(row);
      });
    };
    rebuild();

    const addButton = el('button', { class: 'case-btn-sm', text: '+ Add recipient' });
    addButton.addEventListener('click', () => {
      escalation.recipients.push({ scope: 'User', target: '', value: '' });
      rebuild();
      this.commit();
    });

    wrap.append(listHost, addButton);
    return wrap;
  }
}

/** Serializes a working escalation back to a raw JSON object. */
export function serializeEscalation(escalation: SlaEscalation): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...escalation.raw };
  raw.id = escalation.id ?? genId('esc_', 6);
  if (escalation.displayName) {
    raw.displayName = escalation.displayName;
  } else {
    delete raw.displayName;
  }
  const triggerInfo: Record<string, unknown> = { type: escalation.triggerType };
  if (escalation.triggerType === 'at-risk' && escalation.atRiskPercentage !== undefined) {
    triggerInfo.atRiskPercentage = escalation.atRiskPercentage;
  }
  raw.triggerInfo = triggerInfo;
  raw.action = {
    type: 'notification',
    recipients: escalation.recipients.map((r) => ({
      scope: r.scope,
      target: r.target,
      value: r.value
    }))
  };
  return raw;
}
