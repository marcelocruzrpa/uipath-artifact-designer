/** Reusable editable form controls for the inspector. */
import { el } from '../util';

/** Wraps a control in a labelled field row, with an optional hint line. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const children: Array<Node | string> = [
    el('label', { class: 'field-label', text: label }),
    control
  ];
  if (hint) {
    children.push(el('div', { class: 'field-hint', text: hint }));
  }
  return el('div', { class: 'field' }, children);
}

/** Single-line text input; commits on blur or Enter. */
export function textField(value: string, onCommit: (value: string) => void): HTMLInputElement {
  const input = el('input', { class: 'field-input' });
  input.type = 'text';
  input.value = value;
  let committed = value;
  const commit = (): void => {
    if (input.value !== committed) {
      committed = input.value;
      onCommit(input.value);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });
  return input;
}

/** Multi-line text input; commits on blur. */
export function textArea(
  value: string,
  rows: number,
  onCommit: (value: string) => void
): HTMLTextAreaElement {
  const area = el('textarea', { class: 'field-input field-textarea' });
  area.value = value;
  area.rows = rows;
  let committed = value;
  area.addEventListener('blur', () => {
    if (area.value !== committed) {
      committed = area.value;
      onCommit(area.value);
    }
  });
  return area;
}

/** Numeric input; commits valid numbers on change (blur / Enter). */
export function numberField(
  value: number | undefined,
  opts: { min?: number; max?: number; step?: number },
  onCommit: (value: number) => void
): HTMLInputElement {
  const input = el('input', { class: 'field-input field-number' });
  input.type = 'number';
  if (opts.min !== undefined) {
    input.min = String(opts.min);
  }
  if (opts.max !== undefined) {
    input.max = String(opts.max);
  }
  if (opts.step !== undefined) {
    input.step = String(opts.step);
  }
  if (value !== undefined) {
    input.value = String(value);
  }
  let committed = input.value;
  const commit = (): void => {
    if (input.value === committed) {
      return;
    }
    const parsed = Number(input.value);
    if (input.value.trim() === '' || Number.isNaN(parsed)) {
      return;
    }
    committed = input.value;
    onCommit(parsed);
  };
  input.addEventListener('change', commit);
  return input;
}

/** Dropdown select; commits on change. */
export function selectField(
  value: string,
  options: Array<{ value: string; label: string }>,
  onCommit: (value: string) => void
): HTMLSelectElement {
  const select = el('select', { class: 'field-input' });
  for (const option of options) {
    const optionEl = el('option', { text: option.label });
    optionEl.value = option.value;
    if (option.value === value) {
      optionEl.selected = true;
    }
    select.append(optionEl);
  }
  select.addEventListener('change', () => onCommit(select.value));
  return select;
}

/**
 * Checkbox with an inline label; commits on change. The optional `classes`
 * override lets a renderer with its own styling (e.g. the Case inspector's
 * `case-check` / `case-checkbox` rows) reuse the commit logic without inheriting
 * the default `field-check` look.
 */
export function checkboxField(
  label: string,
  checked: boolean,
  onCommit: (value: boolean) => void,
  classes?: { wrap?: string; input?: string }
): HTMLElement {
  const input = el('input', { class: classes?.input ?? 'field-checkbox' });
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onCommit(input.checked));
  return el('label', { class: classes?.wrap ?? 'field-check' }, [
    input,
    el('span', { text: label })
  ]);
}

/** Free-text input with autocomplete suggestions; commits on blur or Enter. */
export function comboField(
  value: string,
  listId: string,
  suggestions: string[],
  onCommit: (value: string) => void
): HTMLElement {
  const input = el('input', { class: 'field-input' });
  input.type = 'text';
  input.value = value;
  input.setAttribute('list', listId);
  const datalist = el('datalist');
  datalist.id = listId;
  for (const suggestion of suggestions) {
    const option = el('option');
    option.value = suggestion;
    datalist.append(option);
  }
  let committed = value;
  const commit = (): void => {
    if (input.value !== committed) {
      committed = input.value;
      onCommit(input.value);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });
  return el('div', { class: 'combo' }, [input, datalist]);
}
