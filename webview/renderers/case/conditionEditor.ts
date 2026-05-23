/**
 * The DNF **condition editor** widget — edits a stage-entry, stage-exit or
 * case-exit condition collection.
 *
 * Owns its own build → working-copy → commit → rebuild lifecycle: it clones the
 * incoming collection into a working copy, mutates that copy in place as the
 * user edits, and on every change posts the full serialized collection back to
 * the host (`caseSetConditions`). Commits fire on `change` so a re-render after
 * the self-edit does not interrupt typing.
 *
 * Conditions are DNF — `rules[orGroup][andClause]` — but the widget edits only
 * the first OR-group as a single AND-clause list; any extra OR-groups survive
 * untouched on the raw object.
 */
import type { CaseCondition, CaseRule } from '../../../src/model/types';
import type { WebviewToHost } from '../../../src/util/messages';
import { clearChildren, el } from '../../util';
import { caseCheckbox, genId, labeledControl, makeInput, makeSelect } from './caseControls';

/** A condition collection scope handled by the condition editor widget. */
export type ConditionScope = 'stage-entry' | 'stage-exit' | 'case-exit';

/** Stage-entry rule types presented in the rule-type picker. */
const ENTRY_RULE_TYPES = [
  'case-entered',
  'selected-stage-completed',
  'selected-stage-exited',
  'user-selected-stage',
  'wait-for-connector',
  'current-stage-entered',
  'adhoc'
];

/** Stage-exit rule types. */
const EXIT_RULE_TYPES = [
  'required-tasks-completed',
  'selected-tasks-completed',
  'wait-for-connector',
  'adhoc'
];

/** Case-exit rule types. */
const CASE_EXIT_RULE_TYPES = [
  'required-stages-completed',
  'selected-stage-completed',
  'selected-stage-exited',
  'wait-for-connector',
  'adhoc'
];

/** Stage-exit `type` values. */
const EXIT_TYPES = ['exit-only', 'wait-for-user', 'return-to-origin'];

/** Dependencies the condition editor needs from its host inspector. */
export interface ConditionEditorDeps {
  /** Posts a message to the extension host. */
  post: (message: WebviewToHost) => void;
  /** Flags the next host echo as a self-edit so the re-render keeps focus. */
  markSelfEdit: () => void;
  /** All stage ids in the current model, for the `selected-stage-*` pickers. */
  stageIds: () => string[];
}

export class ConditionEditor {
  private readonly scope: ConditionScope;
  private readonly stageId: string | undefined;
  private readonly deps: ConditionEditorDeps;
  /**
   * A working copy the widget mutates; commit() reads from it.
   *
   * NOTE on lifecycle: this snapshot is captured at construction time. If the
   * host pushes a new model while this editor is mounted (e.g. a watcher
   * fires after a sibling file change), the displayed values come from the
   * stale clone until the parent inspector reconstructs the editor. The
   * inspector rebuilds on selection change — which covers the typical case —
   * so external-edit divergence is intentionally accepted for v1.0.
   */
  private readonly working: CaseCondition[];

  constructor(
    scope: ConditionScope,
    conditions: CaseCondition[],
    stageId: string | undefined,
    deps: ConditionEditorDeps
  ) {
    this.scope = scope;
    this.stageId = stageId;
    this.deps = deps;
    this.working = conditions.map((c) => cloneCondition(c));
  }

  /**
   * Builds the condition-editor DOM. Every change rebuilds the whole collection
   * and posts it back to the host.
   */
  build(): HTMLElement {
    const wrap = el('div', { class: 'case-cond-editor' });
    const listHost = el('div', { class: 'case-cond-list' });

    const rebuild = (): void => {
      clearChildren(listHost);
      this.working.forEach((condition, index) => {
        listHost.append(this.buildConditionCard(condition, index, commit, rebuild));
      });
    };

    const commit = (): void => {
      this.deps.markSelfEdit();
      this.deps.post({
        type: 'caseSetConditions',
        scope: this.scope,
        stageId: this.stageId,
        conditions: this.working.map((c) => serializeCondition(this.scope, c))
      });
    };

    const addButton = el('button', { class: 'case-btn', text: '+ Add condition' });
    addButton.addEventListener('click', () => {
      this.working.push(newCondition(this.scope));
      rebuild();
      commit();
    });

    rebuild();
    wrap.append(listHost, addButton);
    return wrap;
  }

  /** Builds a card for one condition, with its rule list. */
  private buildConditionCard(
    condition: CaseCondition,
    index: number,
    commit: () => void,
    rebuild: () => void
  ): HTMLElement {
    const card = el('div', { class: 'case-cond-card' });

    // Header: name + remove.
    const nameInput = makeInput(condition.displayName ?? '', 'Condition name', 'case-input');
    nameInput.addEventListener('change', () => {
      condition.displayName = nameInput.value.trim();
      commit();
    });
    const removeBtn = el('button', { class: 'case-icon-btn', text: '✕', title: 'Remove condition' });
    removeBtn.addEventListener('click', () => {
      this.working.splice(index, 1);
      rebuild();
      commit();
    });
    card.append(el('div', { class: 'case-cond-head' }, [nameInput, removeBtn]));

    // Scope-specific condition fields.
    if (this.scope === 'stage-entry') {
      card.append(
        caseCheckbox('Interrupting', condition.isInterrupting === true, (checked) => {
          condition.isInterrupting = checked;
          commit();
        })
      );
    } else if (this.scope === 'stage-exit') {
      const typeSelect = makeSelect(EXIT_TYPES, condition.type ?? 'exit-only', 'case-select');
      typeSelect.addEventListener('change', () => {
        condition.type = typeSelect.value;
        commit();
      });
      card.append(labeledControl('Exit type', typeSelect));
      card.append(
        caseCheckbox(
          'Marks stage complete',
          condition.marksStageComplete === true,
          (checked) => {
            condition.marksStageComplete = checked;
            commit();
          }
        )
      );
      const exitToInput = makeInput(
        condition.exitToStageId ?? '',
        'Exit-to stage id (optional)',
        'case-input'
      );
      exitToInput.addEventListener('change', () => {
        const value = exitToInput.value.trim();
        condition.exitToStageId = value.length > 0 ? value : undefined;
        commit();
      });
      card.append(labeledControl('Exit to stage', exitToInput));
    } else {
      card.append(
        caseCheckbox(
          'Marks case complete',
          condition.marksCaseComplete === true,
          (checked) => {
            condition.marksCaseComplete = checked;
            commit();
          }
        )
      );
    }

    // Rules — DNF flattened to a single AND-clause list for editing simplicity.
    card.append(this.buildRuleList(condition, commit));
    return card;
  }

  /**
   * Builds the rule list for one condition. The DNF set is edited as a single
   * OR-group of AND rules (`rules[0]`), which covers the vast majority of
   * authored conditions; the raw object preserves any extra OR-groups.
   */
  private buildRuleList(condition: CaseCondition, commit: () => void): HTMLElement {
    const wrap = el('div', { class: 'case-rule-block' });
    wrap.append(el('div', { class: 'case-rule-head', text: 'Rules (all must hold)' }));

    const ruleTypes =
      this.scope === 'stage-entry'
        ? ENTRY_RULE_TYPES
        : this.scope === 'stage-exit'
          ? EXIT_RULE_TYPES
          : CASE_EXIT_RULE_TYPES;

    if (condition.rules.length === 0) {
      condition.rules.push([]);
    }
    const clause = condition.rules[0];

    const listHost = el('div', { class: 'case-rule-list' });
    const rebuild = (): void => {
      clearChildren(listHost);
      clause.forEach((rule, ruleIndex) => {
        listHost.append(this.buildRuleRow(ruleTypes, clause, rule, ruleIndex, commit, rebuild));
      });
    };
    rebuild();

    const addRule = el('button', { class: 'case-btn-sm', text: '+ Add rule' });
    addRule.addEventListener('click', () => {
      clause.push({ id: genId('Rule_', 6), rule: ruleTypes[0], raw: {} });
      rebuild();
      commit();
    });

    wrap.append(listHost, addRule);
    return wrap;
  }

  /** Builds one editable rule row. */
  private buildRuleRow(
    ruleTypes: string[],
    clause: CaseRule[],
    rule: CaseRule,
    index: number,
    commit: () => void,
    rebuild: () => void
  ): HTMLElement {
    const row = el('div', { class: 'case-rule-row' });

    const typeSelect = makeSelect(ruleTypes, rule.rule, 'case-select');
    typeSelect.addEventListener('change', () => {
      rule.rule = typeSelect.value;
      commit();
      rebuild();
    });
    row.append(typeSelect);

    // Side fields per rule type.
    if (rule.rule === 'selected-stage-completed' || rule.rule === 'selected-stage-exited') {
      const stageSelect = this.buildStageIdSelect(rule.selectedStageId ?? '');
      stageSelect.addEventListener('change', () => {
        rule.selectedStageId = stageSelect.value;
        commit();
      });
      row.append(stageSelect);
    } else if (rule.rule === 'selected-tasks-completed') {
      const tasksInput = makeInput(
        (rule.selectedTasksIds ?? []).join(', '),
        'task ids, comma-separated',
        'case-input'
      );
      tasksInput.addEventListener('change', () => {
        rule.selectedTasksIds = tasksInput.value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        commit();
      });
      row.append(tasksInput);
    } else if (rule.rule === 'wait-for-connector' || rule.rule === 'adhoc') {
      const exprInput = makeInput(
        rule.conditionExpression ?? '',
        '=js:<expression>',
        'case-input'
      );
      exprInput.addEventListener('change', () => {
        const value = exprInput.value.trim();
        rule.conditionExpression = value.length > 0 ? value : undefined;
        commit();
      });
      row.append(exprInput);
    }

    const removeBtn = el('button', { class: 'case-icon-btn', text: '✕', title: 'Remove rule' });
    removeBtn.addEventListener('click', () => {
      clause.splice(index, 1);
      rebuild();
      commit();
    });
    row.append(removeBtn);
    return row;
  }

  /** Builds a select of all stage ids in the current model. */
  private buildStageIdSelect(value: string): HTMLSelectElement {
    const options = this.deps.stageIds();
    if (options.length === 0) {
      options.push('');
    }
    if (value && !options.includes(value)) {
      options.unshift(value);
    }
    return makeSelect(options, value, 'case-select');
  }
}

// --- working-copy + serialization --------------------------------------------

/** Builds a fresh empty condition for a scope. */
function newCondition(scope: ConditionScope): CaseCondition {
  const condition: CaseCondition = {
    id: genId('Condition_', 6),
    displayName: '',
    rules: [[]],
    raw: {}
  };
  if (scope === 'stage-entry') {
    condition.isInterrupting = false;
  } else if (scope === 'stage-exit') {
    condition.type = 'exit-only';
    condition.marksStageComplete = true;
  } else {
    condition.marksCaseComplete = true;
  }
  return condition;
}

/** Deep-clones a condition so the widget edits a working copy. */
function cloneCondition(condition: CaseCondition): CaseCondition {
  return {
    ...condition,
    rules: condition.rules.map((clause) => clause.map((rule) => ({ ...rule, raw: { ...rule.raw } }))),
    raw: { ...condition.raw }
  };
}

/** Serializes a working condition back to a raw JSON object. */
function serializeCondition(scope: ConditionScope, condition: CaseCondition): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...condition.raw };
  raw.id = condition.id ?? genId('Condition_', 6);
  if (condition.displayName !== undefined) {
    raw.displayName = condition.displayName;
  }
  raw.rules = condition.rules.map((clause) => clause.map((rule) => serializeRule(rule)));
  if (scope === 'stage-entry') {
    raw.isInterrupting = condition.isInterrupting === true;
  } else if (scope === 'stage-exit') {
    raw.type = condition.type ?? 'exit-only';
    raw.marksStageComplete = condition.marksStageComplete === true;
    if (condition.exitToStageId) {
      raw.exitToStageId = condition.exitToStageId;
    } else {
      delete raw.exitToStageId;
    }
  } else {
    raw.marksCaseComplete = condition.marksCaseComplete === true;
  }
  return raw;
}

/** Serializes a working rule back to a raw JSON object. */
function serializeRule(rule: CaseRule): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...rule.raw };
  raw.id = rule.id ?? genId('Rule_', 6);
  raw.rule = rule.rule;
  if (rule.selectedStageId) {
    raw.selectedStageId = rule.selectedStageId;
  } else {
    delete raw.selectedStageId;
  }
  if (rule.selectedTasksIds && rule.selectedTasksIds.length > 0) {
    raw.selectedTasksIds = rule.selectedTasksIds;
  } else {
    delete raw.selectedTasksIds;
  }
  if (rule.conditionExpression) {
    raw.conditionExpression = rule.conditionExpression;
  } else {
    delete raw.conditionExpression;
  }
  return raw;
}
