/**
 * The Coded App renderer — a form (not a canvas) for the `action-schema.json`
 * data contract, with a read-only panel for `.uipath/app.config.json` status.
 */
import type {
  ActionField,
  ActionFieldEntry,
  ActionSchemaSectionName,
  ArtifactModel,
  CodedAppModel
} from '../../src/model/types';
import type { WebviewViewState } from '../../src/util/messages';
import type { Renderer, RendererHost } from '../renderer';
import { clearChildren, el, factList, note, section } from '../util';

const SCHEMA_SECTIONS: ActionSchemaSectionName[] = ['inputs', 'outputs', 'inOuts', 'outcomes'];

const SECTION_LABELS: Record<ActionSchemaSectionName, string> = {
  inputs: 'Inputs',
  outputs: 'Outputs',
  inOuts: 'In / Out',
  outcomes: 'Outcomes'
};

const SECTION_HINTS: Record<ActionSchemaSectionName, string> = {
  inputs: 'Read-only data passed in from the automation.',
  outputs: 'Fields the reviewer fills in.',
  inOuts: 'Pre-populated values the reviewer can edit.',
  outcomes: 'Submission buttons, e.g. Approve or Reject.'
};

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
const ITEM_TYPES = ['string', 'number', 'integer', 'boolean', 'object'];

function makeSelect(options: string[], value: string, cls: string): HTMLSelectElement {
  const select = el('select', { class: cls });
  for (const option of options) {
    const node = el('option', { text: option });
    node.value = option;
    select.append(node);
  }
  select.value = options.includes(value) ? value : options[0];
  return select;
}

function makeInput(value: string, placeholder: string, cls: string): HTMLInputElement {
  const input = el('input', { class: cls });
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

class CodedAppRenderer implements Renderer {
  private container!: HTMLElement;
  private host!: RendererHost;
  private model: CodedAppModel | null = null;
  private pendingSelfEdit = false;
  private readonly rowFields = new WeakMap<HTMLElement, ActionField>();
  private readonly sectionLists = new Map<ActionSchemaSectionName, HTMLElement>();

  public mount(container: HTMLElement, host: RendererHost): void {
    this.container = container;
    this.host = host;
  }

  public update(model: ArtifactModel): void {
    this.model = model as CodedAppModel;
    if (this.pendingSelfEdit) {
      // Echo of an edit this renderer just made — its DOM is already current.
      this.pendingSelfEdit = false;
      return;
    }
    this.render();
  }

  private render(): void {
    if (!this.model) {
      return;
    }
    clearChildren(this.container);
    this.sectionLists.clear();

    const doc = el('div', { class: 'coded-app' });
    doc.append(this.renderConfig(this.model));
    for (const name of SCHEMA_SECTIONS) {
      doc.append(this.renderSection(name, this.model.actionSchema[name]));
    }
    this.container.append(doc);
  }

  private renderConfig(model: CodedAppModel): HTMLElement {
    const body = model.hasConfig
      ? factList(model.config)
      : note(
          'No .uipath/app.config.json found — it is generated when the app is ' +
            'published with “uip codedapp publish”.'
        );
    return section('App configuration', body);
  }

  private renderSection(name: ActionSchemaSectionName, entries: ActionFieldEntry[]): HTMLElement {
    const list = el('div', { class: 'field-list' });
    this.sectionLists.set(name, list);
    for (const entry of entries) {
      list.append(this.createRow(name, entry));
    }

    const addButton = el('button', {
      class: 'ca-add',
      text: name === 'outcomes' ? '+ Add outcome' : '+ Add field'
    });
    addButton.addEventListener('click', () => {
      const row = this.createRow(name, { name: '', field: { type: 'string' } });
      list.append(row);
      (row.querySelector('.ca-name') as HTMLInputElement | null)?.focus();
    });

    return section(SECTION_LABELS[name], note(SECTION_HINTS[name]), list, addButton);
  }

  private createRow(sectionName: ActionSchemaSectionName, entry: ActionFieldEntry): HTMLElement {
    const row = el('div', { class: 'field-row' });
    this.rowFields.set(row, entry.field);

    const nameInput = makeInput(
      entry.name,
      sectionName === 'outcomes' ? 'OutcomeName' : 'fieldName',
      'ca-name'
    );
    nameInput.addEventListener('change', () => this.commit(sectionName));
    row.append(nameInput);

    if (sectionName !== 'outcomes') {
      const typeSelect = makeSelect(FIELD_TYPES, entry.field.type, 'ca-type');
      const itemsSelect = makeSelect(ITEM_TYPES, entry.field.items?.type ?? 'string', 'ca-items');
      const syncItems = (): void => {
        itemsSelect.classList.toggle('hidden', typeSelect.value !== 'array');
      };
      syncItems();
      typeSelect.addEventListener('change', () => {
        syncItems();
        this.commit(sectionName);
      });
      itemsSelect.addEventListener('change', () => this.commit(sectionName));
      row.append(typeSelect, itemsSelect);

      const requiredLabel = el('label', { class: 'ca-req' });
      const requiredInput = el('input', { class: 'ca-required' });
      requiredInput.type = 'checkbox';
      requiredInput.checked = entry.field.required === true;
      requiredInput.addEventListener('change', () => this.commit(sectionName));
      requiredLabel.append(requiredInput, document.createTextNode('Required'));
      row.append(requiredLabel);

      const descInput = makeInput(entry.field.description ?? '', 'Description', 'ca-desc');
      descInput.addEventListener('change', () => this.commit(sectionName));
      row.append(descInput);
    }

    const removeButton = el('button', { class: 'ca-remove', text: '✕', title: 'Remove' });
    removeButton.addEventListener('click', () => {
      row.remove();
      this.commit(sectionName);
    });
    row.append(removeButton);

    return row;
  }

  /** Collects the section's rows and posts the whole section to the host. */
  private commit(sectionName: ActionSchemaSectionName): void {
    const list = this.sectionLists.get(sectionName);
    if (!list) {
      return;
    }
    const fields: ActionFieldEntry[] = [];
    for (const child of Array.from(list.children)) {
      const row = child as HTMLElement;
      const fieldName = (row.querySelector('.ca-name') as HTMLInputElement).value.trim();
      if (fieldName.length === 0) {
        continue;
      }
      if (sectionName === 'outcomes') {
        fields.push({ name: fieldName, field: { type: 'string' } });
        continue;
      }
      const original = this.rowFields.get(row) ?? { type: 'string' };
      const type = (row.querySelector('.ca-type') as HTMLSelectElement).value;
      const required = (row.querySelector('.ca-required') as HTMLInputElement).checked;
      const description = (row.querySelector('.ca-desc') as HTMLInputElement).value.trim();
      const field: ActionField = { type };
      if (required) {
        field.required = true;
      }
      if (description.length > 0) {
        field.description = description;
      }
      if (type === 'array') {
        field.items = { type: (row.querySelector('.ca-items') as HTMLSelectElement).value };
      }
      if (type === 'object' && original.properties) {
        field.properties = original.properties;
      }
      fields.push({ name: fieldName, field });
    }

    if (this.model) {
      this.model.actionSchema[sectionName] = fields;
    }
    this.pendingSelfEdit = true;
    this.host.post({ type: 'setActionSchemaSection', section: sectionName, fields });
  }

  public fit(): void {
    /* no canvas */
  }

  public zoomIn(): void {
    /* no canvas */
  }

  public zoomOut(): void {
    /* no canvas */
  }

  public getZoom(): number | null {
    return null;
  }

  public getViewState(): WebviewViewState {
    return { zoom: 1, panX: 0, panY: 0, selectedId: null };
  }

  public dispose(): void {
    /* nothing to release */
  }
}

export function createCodedAppRenderer(): Renderer {
  return new CodedAppRenderer();
}
