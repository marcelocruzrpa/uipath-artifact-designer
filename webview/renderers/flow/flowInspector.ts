/**
 * The Maestro Flow inspector panel — a property form for the selected node,
 * plus a flow-overview view when nothing is selected.
 *
 * Self-contained: it builds its own form controls and reuses only the shared
 * `el` / `section` / `note` helpers, so the agent inspector is untouched.
 */
import type { FlowNode, MaestroFlowModel } from '../../../src/model/types';
import type { WebviewToHost } from '../../../src/util/messages';
import { clearChildren, el, note, section } from '../../util';
import { flowKindLabel } from './flowNodeCard';

/** Per-node-type editable input fields, keyed by node kind. */
const KIND_INPUT_FIELDS: Record<string, Array<{ key: string; label: string; multiline: boolean }>> = {
  action: [{ key: 'script', label: 'Script', multiline: true }],
  decision: [{ key: 'expression', label: 'Condition expression', multiline: true }],
  loop: [{ key: 'collection', label: 'Collection expression', multiline: true }],
  trigger: [{ key: 'timerPreset', label: 'Timer preset', multiline: false }]
};

export class FlowInspector {
  private readonly host: HTMLElement;
  private readonly post: (message: WebviewToHost) => void;
  /** Set while echoing a self-made edit, so re-render does not steal focus. */
  public suppressNextRender = false;

  constructor(host: HTMLElement, post: (message: WebviewToHost) => void) {
    this.host = host;
    this.post = post;
  }

  /** Renders the empty-state overview for a flow with no node selected. */
  showOverview(model: MaestroFlowModel): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: model.flowName || model.title }),
          el('div', { class: 'inspector-subtitle', text: 'Maestro Flow' })
        ])
      ])
    );

    const facts = el('dl', { class: 'facts' });
    const addFact = (label: string, value: string): void => {
      facts.append(el('dt', { text: label }), el('dd', { text: value }));
    };
    addFact('Nodes', String(model.nodes.length));
    addFact('Edges', String(model.edges.length));
    addFact('Variables', String(model.variables.length));
    if (model.version) {
      addFact('Schema version', model.version);
    }
    body.append(section('Flow', facts));

    if (model.variables.length > 0) {
      const list = el('div', { class: 'flow-var-list' });
      for (const variable of model.variables) {
        list.append(
          el('div', { class: 'flow-var-row' }, [
            el('span', { class: 'flow-var-name', text: variable.id }),
            el('span', { class: 'flow-var-dir', text: variable.direction }),
            el('span', { class: 'flow-var-type', text: variable.type })
          ])
        );
      }
      body.append(section('Variables', list));
    }

    body.append(note('Select a node to edit its label and inputs.'));
    this.host.append(body);
  }

  /** Renders the editable property form for one selected node. */
  showNode(node: FlowNode): void {
    clearChildren(this.host);
    const body = el('div', { class: 'inspector-body' });

    body.append(
      el('div', { class: 'inspector-header' }, [
        el('div', { class: 'inspector-titles' }, [
          el('div', { class: 'inspector-title', text: node.label }),
          el('div', { class: 'inspector-subtitle', text: flowKindLabel(node.kind) })
        ])
      ])
    );

    // --- Identity facts ---
    const facts = el('dl', { class: 'facts' });
    facts.append(el('dt', { text: 'Id' }), el('dd', { text: node.id }));
    facts.append(el('dt', { text: 'Type' }), el('dd', { text: node.type }));
    facts.append(el('dt', { text: 'Type version' }), el('dd', { text: node.typeVersion }));
    body.append(section('Identity', facts));

    // --- Label editor ---
    body.append(
      section(
        'Label',
        this.textField('Display label', node.label, false, (value) => {
          this.suppressNextRender = true;
          this.post({ type: 'flowSetNodeLabel', nodeId: node.id, label: value });
        })
      )
    );

    // --- Per-kind input editors ---
    const fields = KIND_INPUT_FIELDS[node.kind];
    if (fields && fields.length > 0) {
      const inputSection = section('Inputs');
      for (const field of fields) {
        const current = node.rawInputs[field.key];
        const value = typeof current === 'string' ? current : '';
        inputSection.append(
          this.textField(field.label, value, field.multiline, (next) => {
            this.suppressNextRender = true;
            this.post({
              type: 'flowSetNodeInput',
              nodeId: node.id,
              key: field.key,
              value: next
            });
          })
        );
      }
      body.append(inputSection);
    }

    // --- Read-only inputs view for kinds without a tailored form ---
    const inputKeys = Object.keys(node.rawInputs);
    if ((!fields || fields.length === 0) && inputKeys.length > 0) {
      const inputFacts = el('dl', { class: 'facts' });
      for (const key of inputKeys) {
        const raw = node.rawInputs[key];
        const text =
          typeof raw === 'string'
            ? raw
            : raw === undefined
              ? ''
              : JSON.stringify(raw);
        inputFacts.append(
          el('dt', { text: key }),
          el('dd', { text: text.length > 0 ? text : '—' })
        );
      }
      body.append(section('Inputs (read-only)', inputFacts));
    }

    // --- Ports ---
    const portLine = (label: string, ids: string[]): HTMLElement =>
      el('div', { class: 'flow-port-row' }, [
        el('span', { class: 'flow-port-label', text: label }),
        el('span', {
          class: 'flow-port-values',
          text: ids.length > 0 ? ids.join(', ') : '—'
        })
      ]);
    body.append(
      section(
        'Ports',
        portLine('In', node.inputs.map((p) => p.id)),
        portLine('Out', node.outputs.map((p) => p.id))
      )
    );

    // --- Danger zone ---
    const removeBtn = el('button', {
      class: 'flow-remove-node',
      text: 'Delete node'
    });
    removeBtn.addEventListener('click', () => {
      this.post({ type: 'flowRemoveNode', nodeId: node.id });
    });
    body.append(section('Delete', note('Removes this node and every connected edge.'), removeBtn));

    this.host.append(body);
  }

  /** Renders the empty placeholder when no model is loaded. */
  showEmpty(): void {
    clearChildren(this.host);
    this.host.append(
      el('div', { class: 'inspector-empty', text: 'No flow loaded.' })
    );
  }

  /**
   * Builds a labeled text input (or textarea), committing on `change` so a
   * re-render after the self-edit does not interrupt typing.
   */
  private textField(
    label: string,
    value: string,
    multiline: boolean,
    onCommit: (value: string) => void
  ): HTMLElement {
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { class: 'field-label', text: label }));

    let control: HTMLInputElement | HTMLTextAreaElement;
    if (multiline) {
      const textarea = el('textarea', { class: 'field-input field-textarea' });
      textarea.value = value;
      textarea.rows = 3;
      control = textarea;
    } else {
      const input = el('input', { class: 'field-input' });
      input.type = 'text';
      input.value = value;
      control = input;
    }
    control.addEventListener('change', () => onCommit(control.value));
    wrap.append(control);
    return wrap;
  }
}
