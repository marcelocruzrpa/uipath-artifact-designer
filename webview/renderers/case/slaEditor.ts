/**
 * The **SLA editor** widget — edits one `slaRules[]` collection on the case
 * root or a stage.
 *
 * Owns its own build → working-copy → commit → rebuild lifecycle: it clones the
 * incoming array into a working copy, mutates that copy in place, and on every
 * change posts the full serialized array back to the host (`caseSetSlaRules`).
 * Commits fire on `change` so a re-render after the self-edit does not interrupt
 * typing. Each SLA rule's escalation list is delegated to {@link EscalationEditor}.
 */
import type { SlaRuleEntry } from '../../../src/model/types';
import type { WebviewToHost } from '../../../src/util/messages';
import { clearChildren, el } from '../../util';
import { labeledControl, makeInput, makeSelect } from './caseControls';
import { EscalationEditor, serializeEscalation } from './escalationEditor';

/** SLA time units. */
const SLA_UNITS = ['min', 'h', 'd', 'w', 'm'];

/** Dependencies the SLA editor needs from its host inspector. */
export interface SlaEditorDeps {
  /** Posts a message to the extension host. */
  post: (message: WebviewToHost) => void;
  /** Flags the next host echo as a self-edit so the re-render keeps focus. */
  markSelfEdit: () => void;
}

export class SlaEditor {
  private readonly stageId: string | undefined;
  private readonly deps: SlaEditorDeps;
  /** A working copy the widget mutates; commit() reads from it. */
  private readonly working: SlaRuleEntry[];

  constructor(slaRules: SlaRuleEntry[], stageId: string | undefined, deps: SlaEditorDeps) {
    this.stageId = stageId;
    this.deps = deps;
    this.working = slaRules.map((r) => cloneSlaRule(r));
  }

  /**
   * Builds the SLA-editor DOM. Every change rebuilds the whole array and posts
   * it back to the host.
   */
  build(): HTMLElement {
    const wrap = el('div', { class: 'case-sla-editor' });
    const listHost = el('div', { class: 'case-sla-list' });

    const commit = (): void => {
      this.deps.markSelfEdit();
      this.deps.post({
        type: 'caseSetSlaRules',
        stageId: this.stageId,
        slaRules: this.working.map((r) => serializeSlaRule(r))
      });
    };
    const rebuild = (): void => {
      clearChildren(listHost);
      this.working.forEach((rule, index) => {
        listHost.append(this.buildSlaRuleCard(rule, index, commit, rebuild));
      });
    };
    rebuild();

    const addButton = el('button', { class: 'case-btn', text: '+ Add SLA rule' });
    addButton.addEventListener('click', () => {
      // A new conditional rule; the default `=js:true` rule should stay last.
      const isFirst = this.working.length === 0;
      this.working.push({
        expression: isFirst ? '=js:true' : '=js:',
        count: 1,
        unit: 'd',
        escalationRule: [],
        raw: {}
      });
      rebuild();
      commit();
    });

    wrap.append(listHost, addButton);
    return wrap;
  }

  /** Builds a card for one SLA rule, with its escalation list. */
  private buildSlaRuleCard(
    rule: SlaRuleEntry,
    index: number,
    commit: () => void,
    rebuild: () => void
  ): HTMLElement {
    const card = el('div', { class: 'case-sla-card' });
    const isDefault = rule.expression === '=js:true';

    const head = el('div', { class: 'case-sla-head' });
    head.append(
      el('span', {
        class: 'case-sla-tag',
        text: isDefault ? 'Default' : 'Conditional'
      })
    );
    const removeBtn = el('button', { class: 'case-icon-btn', text: '✕', title: 'Remove SLA rule' });
    removeBtn.addEventListener('click', () => {
      this.working.splice(index, 1);
      rebuild();
      commit();
    });
    head.append(removeBtn);
    card.append(head);

    // Expression (editable only for conditional rules).
    if (!isDefault) {
      const exprInput = makeInput(rule.expression, '=js:<expression>', 'case-input');
      exprInput.addEventListener('change', () => {
        rule.expression = exprInput.value.trim() || '=js:';
        commit();
      });
      card.append(labeledControl('Expression', exprInput));
    }

    // Count + unit.
    const countInput = el('input', { class: 'case-input case-input--num' });
    countInput.type = 'number';
    countInput.min = '0';
    countInput.value = rule.count !== undefined ? String(rule.count) : '';
    countInput.addEventListener('change', () => {
      const parsed = Number(countInput.value);
      rule.count = countInput.value.trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined;
      commit();
    });
    const unitSelect = makeSelect(SLA_UNITS, rule.unit ?? 'd', 'case-select');
    unitSelect.addEventListener('change', () => {
      rule.unit = unitSelect.value;
      commit();
    });
    card.append(
      labeledControl('Duration', el('div', { class: 'case-row' }, [countInput, unitSelect]))
    );

    // Escalations.
    card.append(new EscalationEditor(rule, commit).build());
    return card;
  }
}

// --- working-copy + serialization --------------------------------------------

/** Deep-clones an SLA rule so the widget edits a working copy. */
function cloneSlaRule(rule: SlaRuleEntry): SlaRuleEntry {
  return {
    ...rule,
    escalationRule: rule.escalationRule.map((e) => ({
      ...e,
      recipients: e.recipients.map((r) => ({ ...r })),
      raw: { ...e.raw }
    })),
    raw: { ...rule.raw }
  };
}

/** Serializes a working SLA rule back to a raw JSON object. */
function serializeSlaRule(rule: SlaRuleEntry): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...rule.raw };
  raw.expression = rule.expression;
  if (rule.count !== undefined) {
    raw.count = rule.count;
  } else {
    delete raw.count;
  }
  if (rule.unit !== undefined) {
    raw.unit = rule.unit;
  } else {
    delete raw.unit;
  }
  raw.escalationRule = rule.escalationRule.map((e) => serializeEscalation(e));
  return raw;
}
