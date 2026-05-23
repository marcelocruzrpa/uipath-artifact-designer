/** Editable input/output arguments list for the inspector. */
import type { JsonSchema, JsonSchemaProp } from '../../src/model/types';
import type { ArgProperty } from '../../src/util/messages';
import { el } from '../util';

const TYPE_OPTIONS = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

function isFileProp(prop: JsonSchemaProp): boolean {
  return typeof prop.$ref === 'string' && prop.$ref.includes('job-attachment');
}

interface RowRefs {
  rowEl: HTMLElement;
  name: HTMLInputElement;
  typeSelect: HTMLSelectElement | null;
  isFile: boolean;
  description: HTMLInputElement;
  required: HTMLInputElement;
}

/**
 * Renders the argument rows. Any change posts the full argument list back via
 * `onChange` — the host replaces the schema wholesale.
 */
export function renderArgumentsEditor(
  schema: JsonSchema | undefined,
  onChange: (properties: ArgProperty[], required: string[]) => void
): HTMLElement {
  const container = el('div', { class: 'args-editor' });
  const rowsWrap = el('div', { class: 'args-rows' });
  const rows: RowRefs[] = [];

  const commit = (): void => {
    const properties: ArgProperty[] = [];
    const required: string[] = [];
    for (const row of rows) {
      const name = row.name.value.trim();
      if (name.length === 0) {
        continue;
      }
      const type = row.isFile ? 'file' : row.typeSelect ? row.typeSelect.value : 'string';
      properties.push({ name, type, description: row.description.value });
      if (row.required.checked) {
        required.push(name);
      }
    }
    onChange(properties, required);
  };

  const commitOnBlur = (input: HTMLInputElement): void => {
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  };

  const addRow = (
    name: string,
    type: string,
    description: string,
    isRequired: boolean,
    isFile: boolean
  ): void => {
    const nameInput = el('input', { class: 'field-input args-name' });
    nameInput.type = 'text';
    nameInput.value = name;
    nameInput.placeholder = 'name';

    let typeSelect: HTMLSelectElement | null = null;
    let typeControl: HTMLElement;
    if (isFile) {
      typeControl = el('span', { class: 'args-type-file', text: 'file', title: 'job-attachment' });
    } else {
      typeSelect = el('select', { class: 'field-input args-type' });
      for (const option of TYPE_OPTIONS) {
        const optionEl = el('option', { text: option });
        optionEl.value = option;
        if (option === type) {
          optionEl.selected = true;
        }
        typeSelect.append(optionEl);
      }
      typeControl = typeSelect;
    }

    const descriptionInput = el('input', { class: 'field-input args-desc' });
    descriptionInput.type = 'text';
    descriptionInput.value = description;
    descriptionInput.placeholder = 'description';

    const requiredInput = el('input', { class: 'args-req' });
    requiredInput.type = 'checkbox';
    requiredInput.checked = isRequired;

    const removeButton = el('button', {
      class: 'args-remove',
      text: '✕',
      title: 'Remove argument'
    });

    const rowEl = el('div', { class: 'args-row' }, [
      nameInput,
      typeControl,
      descriptionInput,
      el('label', { class: 'args-req-wrap', title: 'Required' }, [requiredInput]),
      removeButton
    ]);

    const refs: RowRefs = {
      rowEl,
      name: nameInput,
      typeSelect,
      isFile,
      description: descriptionInput,
      required: requiredInput
    };
    rows.push(refs);

    commitOnBlur(nameInput);
    commitOnBlur(descriptionInput);
    if (typeSelect) {
      typeSelect.addEventListener('change', commit);
    }
    requiredInput.addEventListener('change', commit);
    removeButton.addEventListener('click', () => {
      const index = rows.indexOf(refs);
      if (index >= 0) {
        rows.splice(index, 1);
      }
      rowEl.remove();
      commit();
    });

    rowsWrap.append(rowEl);
  };

  const properties = schema?.properties ?? {};
  const requiredSet = new Set(schema?.required ?? []);
  for (const name of Object.keys(properties)) {
    const prop = properties[name];
    addRow(
      name,
      prop.type ?? 'string',
      prop.description ?? '',
      requiredSet.has(name),
      isFileProp(prop)
    );
  }

  if (rows.length === 0) {
    rowsWrap.append(el('p', { class: 'muted-note', text: 'No arguments.' }));
  }
  container.append(rowsWrap);

  const addButton = el('button', { class: 'args-add', text: '+ Add argument' });
  addButton.addEventListener('click', () => {
    const emptyNote = rowsWrap.querySelector('.muted-note');
    if (emptyNote) {
      emptyNote.remove();
    }
    addRow('newArgument', 'string', '', false, false);
    commit();
  });
  container.append(addButton);

  return container;
}
