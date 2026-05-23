/**
 * Inline form controls shared by the Maestro Case inspector and its extracted
 * condition / SLA / escalation editor widgets.
 *
 * These differ from the shared `components/formControls.ts` controls in two
 * ways that make them a deliberate, separate set rather than duplication:
 *
 *  - they use the Case designer's compact inline-row styling (`case-input` /
 *    `case-select`), not the full-width block `field-input` look, and
 *  - text / select inputs commit on the raw `change` event so an inline rule
 *    row commits the moment the value changes, matching the widgets' existing
 *    whole-collection-replace contract.
 *
 * The labelled-checkbox helper does reuse the shared `checkboxField` commit
 * logic via its class-override option, keeping a single checkbox implementation.
 */
import { checkboxField as sharedCheckboxField } from '../../components/formControls';
import { el } from '../../util';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generates a prefixed id matching the CLI `prefixedId(prefix, count)` scheme. */
export function genId(prefix: string, count: number): string {
  let suffix = '';
  for (let i = 0; i < count; i++) {
    suffix += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return prefix + suffix;
}

/** Builds an inline `<select>` from a string list; falls back to the first option. */
export function makeSelect(options: string[], value: string, cls: string): HTMLSelectElement {
  const select = el('select', { class: cls });
  for (const option of options) {
    const node = el('option', { text: option });
    node.value = option;
    select.append(node);
  }
  select.value = options.includes(value) ? value : options[0];
  return select;
}

/** Builds an inline single-line text input. */
export function makeInput(value: string, placeholder: string, cls: string): HTMLInputElement {
  const input = el('input', { class: cls });
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

/**
 * Builds a labeled checkbox row in the Case inspector's `case-check` styling,
 * reusing the shared `checkboxField` commit logic.
 */
export function caseCheckbox(
  label: string,
  checked: boolean,
  onCommit: (checked: boolean) => void
): HTMLElement {
  return sharedCheckboxField(label, checked, onCommit, {
    wrap: 'case-check',
    input: 'case-checkbox'
  });
}

/** Wraps a control with a label above it (a `field` / `field-label` block). */
export function labeledControl(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', text: label }),
    control
  ]);
}
