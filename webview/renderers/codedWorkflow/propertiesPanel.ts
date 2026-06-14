/**
 * The coded-workflow properties panel — a docked, per-card view of an activity
 * card's arguments. It doubles as a read-only INSPECTOR (every field disabled)
 * and, in edit mode, a value EDITOR.
 *
 * Editing targets the RAW SOURCE TOKEN (`arg.valueRaw`) for every kind EXCEPT
 * `string`, which edits the unquoted CONTENT (`arg.value`): the host owns the
 * C# quotes (it re-emits the literal), so a low-code dev edits the message TEXT
 * and can never decay a string into a bare identifier by dropping the quotes.
 * For non-string kinds the text round-tripped through the input is the exact
 * source slice, resolved against the arg's `valueSpan`. An arg is editable only
 * when ALL hold:
 *   - the panel is in edit mode,
 *   - `arg.editableKind !== 'none'` (synthesized summaries are read-only), and
 *   - `arg.valueRaw !== undefined` (there is a single backing token to patch).
 *
 * Pure DOM builder — no renderer state, no innerHTML (the `el` helper and
 * direct property assignment only). The `onEdit` callback hands an
 * `editValue`-shaped intent back to the renderer, which posts it to the host.
 */
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';
import { el } from '../../util';

/** The edit intent emitted when a value field changes (mirrors `editValue`). */
export interface PropertiesEdit {
  id: string;
  argIndex: number;
  newText: string;
}

export interface PropertiesPanelOptions {
  /** When false, every field is disabled — the panel is a read-only inspector. */
  editing: boolean;
  /** Called with the new RAW text when an editable field changes. */
  onEdit: (edit: PropertiesEdit) => void;
}

/** Builds the docked properties panel for one activity card. */
export function renderPropertiesPanel(
  card: CwActivityCard,
  opts: PropertiesPanelOptions
): HTMLElement {
  const panel = el('div', { class: 'cw-props' });
  panel.append(
    el('div', {
      class: 'cw-props-title',
      text: card.title,
      title: `${card.serviceDisplayName} · ${card.method}`
    })
  );

  if (card.args.length === 0) {
    panel.append(el('div', { class: 'cw-props-empty', text: 'No editable arguments.' }));
    return panel;
  }

  card.args.forEach((arg, argIndex) => {
    const row = el('div', { class: 'cw-props-row' }, [
      el('label', { class: 'cw-props-label', text: arg.label })
    ]);

    const input = document.createElement('input');
    input.className = 'cw-props-input';
    input.type = 'text';
    // String fields show the unquoted CONTENT (the host re-quotes on save);
    // every other editable kind shows the raw source token it patches in place.
    input.value = arg.editableKind === 'string' ? arg.value : (arg.valueRaw ?? arg.value);

    // Read-only mode disables everything (the inspector); `none` args and args
    // with no single backing token are never editable, in any mode.
    const disabled = !opts.editing || arg.editableKind === 'none' || arg.valueRaw === undefined;
    input.disabled = disabled;

    if (arg.editableKind === 'raw') {
      // Expressions / interpolated strings round-trip as raw text; the host's
      // parse-gate is the safety net against a value that won't compile.
      input.title = 'expression — edited as raw text';
    }

    input.addEventListener('change', () => {
      if (input.disabled) {
        return;
      }
      opts.onEdit({ id: card.id, argIndex, newText: input.value });
    });

    row.append(input);
    panel.append(row);
  });

  return panel;
}
