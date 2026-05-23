/**
 * The Maestro Case inspector panel — a property form for the selected node
 * (stage, exception-stage, trigger, sticky-note) and a case-overview view when
 * nothing is selected.
 *
 * The condition (DNF rules), SLA and escalation editors live in their own
 * widget classes — {@link ConditionEditor}, {@link SlaEditor} and
 * {@link EscalationEditor} — which this inspector composes. Each widget owns its
 * build → working-copy → commit → rebuild lifecycle and posts the whole edited
 * collection back to the host. Commits fire on `change` so a re-render after the
 * self-edit does not interrupt typing.
 *
 * Labeled property fields reuse the shared `components/formControls.ts` helpers;
 * the compact inline-row controls used inside the editor widgets live in
 * `caseControls.ts`.
 */
import type {
  CaseEdge,
  CaseStage,
  CaseStickyNote,
  CaseTrigger,
  MaestroCaseModel
} from '../../../src/model/types';
import type { WebviewToHost } from '../../../src/util/messages';
import { field, textArea, textField } from '../../components/formControls';
import { clearChildren, el, note, section } from '../../util';
import { caseCheckbox, makeInput, makeSelect } from './caseControls';
import { ConditionEditor, type ConditionScope } from './conditionEditor';
import { SlaEditor } from './slaEditor';

export class CaseInspector {
  private readonly host: HTMLElement;
  private readonly post: (message: WebviewToHost) => void;
  /** Set while echoing a self-made edit, so re-render does not steal focus. */
  public suppressNextRender = false;
  /** The current model — needed for cross-references (stage / task id lists). */
  private model: MaestroCaseModel | null = null;

  constructor(host: HTMLElement, post: (message: WebviewToHost) => void) {
    this.host = host;
    this.post = post;
  }

  /** Records the current model so editor widgets can resolve cross-references. */
  setModel(model: MaestroCaseModel): void {
    this.model = model;
  }

  // --- overview -----------------------------------------------------------

  /** Renders the case-overview view when no node is selected. */
  showOverview(model: MaestroCaseModel): void {
    this.model = model;
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: model.root.name || model.title }),
          el('div', { class: 'inspector-subtitle', text: 'Maestro Case' })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    const addFact = (label: string, value: string): void => {
      facts.append(el('dt', { text: label }), el('dd', { text: value }));
    };
    addFact('Schema', model.schemaVersion);
    if (model.root.caseIdentifier) {
      addFact('Identifier', model.root.caseIdentifier);
    }
    addFact('Stages', String(model.stages.length));
    addFact('Edges', String(model.edges.length));
    addFact('Sticky notes', String(model.stickyNotes.length));
    body.append(section('Case', facts));

    if (model.root.description) {
      body.append(section('Description', note(model.root.description)));
    }

    // --- Add-stage controls ---
    body.append(this.buildAddStage());

    // --- Case-exit conditions ---
    body.append(
      section(
        'Case exit conditions',
        note('Conditions that mark the whole case complete.'),
        this.buildConditionEditor('case-exit', model.caseExitConditions, undefined)
      )
    );

    // --- Case-root SLA ---
    body.append(
      section(
        'Case SLA',
        note('Service-level rules evaluated for the whole case.'),
        this.buildSlaEditor(model.slaRules, undefined)
      )
    );

    this.host.append(body);
  }

  /** Builds the "add stage" control block for the overview. */
  private buildAddStage(): HTMLElement {
    const labelInput = makeInput('', 'New stage label', 'case-input');
    const kindSelect = makeSelect(['stage', 'exception-stage'], 'stage', 'case-select');
    const addButton = el('button', { class: 'case-btn', text: '+ Add stage' });
    addButton.addEventListener('click', () => {
      const label = labelInput.value.trim();
      if (label.length === 0) {
        labelInput.focus();
        return;
      }
      this.post({
        type: 'caseAddStage',
        stageKind: kindSelect.value === 'exception-stage' ? 'exception-stage' : 'stage',
        label,
        description: '',
        isRequired: false
      });
      labelInput.value = '';
    });
    const row = el('div', { class: 'case-row' }, [labelInput, kindSelect, addButton]);
    return section('Add stage', row);
  }

  // --- node forms ---------------------------------------------------------

  /** Renders the editable property form for a selected stage / exception stage. */
  showStage(stage: CaseStage): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });
    const kindLabel = stage.kind === 'exception-stage' ? 'Exception Stage' : 'Stage';

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: stage.label }),
          el('div', { class: 'inspector-subtitle', text: kindLabel })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    facts.append(el('dt', { text: 'Id' }), el('dd', { text: stage.id }));
    body.append(section('Identity', facts));

    // --- Stage fields ---
    const fields = section('Stage');
    fields.append(
      field(
        'Label',
        textField(stage.label, (value) => {
          this.suppressNextRender = true;
          this.post({ type: 'caseSetStageField', stageId: stage.id, field: 'label', value });
        })
      )
    );
    fields.append(
      field(
        'Description',
        textArea(stage.description, 3, (value) => {
          this.suppressNextRender = true;
          this.post({
            type: 'caseSetStageField',
            stageId: stage.id,
            field: 'description',
            value
          });
        })
      )
    );
    fields.append(
      caseCheckbox('Required', stage.isRequired, (checked) => {
        this.suppressNextRender = true;
        this.post({
          type: 'caseSetStageField',
          stageId: stage.id,
          field: 'isRequired',
          value: checked
        });
      })
    );
    body.append(fields);

    // --- Tasks (read-only) ---
    body.append(this.buildTaskList(stage));

    // --- Entry conditions ---
    body.append(
      section(
        'Entry conditions',
        note('Conditions that must hold for the stage to be entered.'),
        this.buildConditionEditor('stage-entry', stage.entryConditions, stage.id)
      )
    );

    // --- Exit conditions ---
    body.append(
      section(
        'Exit conditions',
        note('Conditions that route the case out of this stage.'),
        this.buildConditionEditor('stage-exit', stage.exitConditions, stage.id)
      )
    );

    // --- Stage SLA ---
    body.append(
      section(
        'Stage SLA',
        note('Service-level rules evaluated while this stage is active.'),
        this.buildSlaEditor(stage.slaRules, stage.id)
      )
    );

    // --- Delete ---
    const removeBtn = el('button', { class: 'case-remove', text: 'Delete stage' });
    removeBtn.addEventListener('click', () => {
      this.post({ type: 'caseDeleteStage', stageId: stage.id });
    });
    body.append(
      section('Delete', note('Removes this stage and every connected edge.'), removeBtn)
    );

    this.host.append(body);
  }

  /** Renders the read-only task list for a stage. */
  private buildTaskList(stage: CaseStage): HTMLElement {
    const total = stage.tasks.reduce((sum, lane) => sum + lane.length, 0);
    if (total === 0) {
      return section('Tasks', note('This stage has no tasks. Task authoring is not yet available here.'));
    }
    const list = el('div', { class: 'case-task-list' });
    stage.tasks.forEach((lane, laneIndex) => {
      for (const task of lane) {
        list.append(
          el('div', { class: 'case-task-row' }, [
            el('span', { class: 'case-task-lane', text: `L${laneIndex}` }),
            el('span', {
              class: 'case-task-name',
              text: task.displayName || task.id,
              title: task.id
            }),
            el('span', { class: 'case-task-type', text: task.type })
          ])
        );
      }
    });
    return section('Tasks (read-only)', list);
  }

  /** Renders the editable property form for the trigger node. */
  showTrigger(trigger: CaseTrigger): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: trigger.label }),
          el('div', { class: 'inspector-subtitle', text: 'Trigger' })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    facts.append(el('dt', { text: 'Id' }), el('dd', { text: trigger.id }));
    facts.append(el('dt', { text: 'Service type' }), el('dd', { text: trigger.serviceType }));
    body.append(section('Identity', facts));

    body.append(
      section(
        'Trigger',
        field(
          'Label',
          textField(trigger.label, (value) => {
            this.suppressNextRender = true;
            this.post({ type: 'caseSetTriggerLabel', triggerId: trigger.id, label: value });
          })
        )
      )
    );

    this.host.append(body);
  }

  /** Renders the editable property form for a selected edge. */
  showEdge(edge: CaseEdge): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });
    const typeLabel =
      edge.type === 'case-management:TriggerEdge' ? 'Trigger edge' : 'Edge';

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: edge.label || edge.id }),
          el('div', { class: 'inspector-subtitle', text: typeLabel })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    facts.append(el('dt', { text: 'Id' }), el('dd', { text: edge.id }));
    facts.append(el('dt', { text: 'Source' }), el('dd', { text: edge.source }));
    facts.append(el('dt', { text: 'Target' }), el('dd', { text: edge.target }));
    body.append(section('Identity', facts));

    body.append(
      section(
        'Edge',
        field(
          'Label',
          textField(edge.label, (value) => {
            this.suppressNextRender = true;
            this.post({ type: 'caseSetEdgeLabel', edgeId: edge.id, label: value });
          })
        )
      )
    );

    const removeBtn = el('button', { class: 'case-remove', text: 'Delete edge' });
    removeBtn.addEventListener('click', () => {
      this.post({ type: 'caseDeleteEdge', edgeId: edge.id });
    });
    body.append(section('Delete', note('Removes this transition.'), removeBtn));

    this.host.append(body);
  }

  /** Renders the read-only property view for a selected sticky note. */
  showStickyNote(stickyNote: CaseStickyNote): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: stickyNote.label || 'Note' }),
          el('div', { class: 'inspector-subtitle', text: 'Sticky note' })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    facts.append(el('dt', { text: 'Id' }), el('dd', { text: stickyNote.id }));
    facts.append(el('dt', { text: 'Color' }), el('dd', { text: stickyNote.color }));
    body.append(section('Identity', facts));
    body.append(section('Content', note(stickyNote.content || '(empty)')));

    this.host.append(body);
  }

  /** Renders the empty placeholder when no model is loaded. */
  showEmpty(): void {
    clearChildren(this.host);
    this.host.append(el('div', { class: 'inspector-empty', text: 'No case loaded.' }));
  }

  // --- editor widgets -----------------------------------------------------

  /** Builds a {@link ConditionEditor} for one collection scope. */
  private buildConditionEditor(
    scope: ConditionScope,
    conditions: MaestroCaseModel['caseExitConditions'],
    stageId: string | undefined
  ): HTMLElement {
    return new ConditionEditor(scope, conditions, stageId, {
      post: this.post,
      markSelfEdit: () => {
        this.suppressNextRender = true;
      },
      stageIds: () => (this.model ? this.model.stages.map((s) => s.id) : [])
    }).build();
  }

  /** Builds a {@link SlaEditor} for one `slaRules[]` collection. */
  private buildSlaEditor(
    slaRules: MaestroCaseModel['slaRules'],
    stageId: string | undefined
  ): HTMLElement {
    return new SlaEditor(slaRules, stageId, {
      post: this.post,
      markSelfEdit: () => {
        this.suppressNextRender = true;
      }
    }).build();
  }
}
