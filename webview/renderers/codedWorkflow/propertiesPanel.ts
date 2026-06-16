/**
 * The coded-workflow properties panel — a docked, per-card view of an activity
 * card's arguments. It doubles as a read-only INSPECTOR (every field disabled)
 * and, in edit mode, a value EDITOR plus a STRUCTURAL editor (L1): remove an
 * argument, add an optional one from the catalog, or switch the called method.
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
 * The STRUCTURAL affordances appear ONLY in edit mode and the webview NEVER
 * writes: each control hands an `editArg`-shaped intent to `onArgEdit`, which
 * the renderer posts to the host; the host owns the WorkspaceEdit behind the
 * parse-gate. Removing an arg needs a backing `argSpan` (so the host can splice
 * the exact node). The add/method controls read the bidirectional `emit` schema
 * from the tier-1 catalog (pure data — safe in the webview bundle).
 *
 * Pure DOM builder — no renderer state, no innerHTML (the `el` helper and
 * direct property assignment only).
 */
import type { CwActivityCard } from '../../../src/model/codedWorkflow/cwTypes';
import {
  TIER1_CATALOG,
  type CatalogEmitArg
} from '../../../src/model/codedWorkflow/classify/tier1Catalog';
import { el } from '../../util';

/** The edit intent emitted when a value field changes (mirrors `editValue`). */
export interface PropertiesEdit {
  id: string;
  argIndex: number;
  newText: string;
}

/** Structural edit intent emitted by the panel (mirrors `editArg`). */
export interface PropertiesArgEdit {
  id: string;
  op: 'change' | 'add' | 'remove' | 'method';
  argIndex?: number;
  newText?: string;
  newMethod?: string;
}

export interface PropertiesPanelOptions {
  /** When false, every field is disabled — the panel is a read-only inspector. */
  editing: boolean;
  /** Called with the new RAW text when an editable field changes. */
  onEdit: (edit: PropertiesEdit) => void;
  /** Structural argument / method edits. */
  onArgEdit: (edit: PropertiesArgEdit) => void;
}

/** The catalog entry's emit args for a card, or [] when the call is uncataloged. */
function emitArgsFor(card: CwActivityCard): CatalogEmitArg[] {
  const family = TIER1_CATALOG.find((f) => f.id === card.service);
  const entry = family?.entries.find((e) => e.method === card.method);
  return entry?.emit?.args ?? [];
}

/** Sibling method names in the card's family that carry an emit schema. */
function siblingMethods(card: CwActivityCard): string[] {
  const family = TIER1_CATALOG.find((f) => f.id === card.service);
  if (family === undefined) return [];
  return family.entries.filter((e) => e.emit !== undefined).map((e) => e.method);
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

  // Method switch (overload / sibling method) — only in edit mode, only when the
  // family catalogs more than one emittable method. Switching leaves args intact.
  if (opts.editing) {
    const methods = siblingMethods(card);
    if (methods.length > 1) {
      panel.append(buildMethodSelect(card, methods, opts));
    }
  }

  if (card.args.length === 0 && !opts.editing) {
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

    // Structural remove (×): edit mode only, and only when the arg has a single
    // backing `argument` node the host can splice out.
    if (opts.editing && arg.argSpan !== undefined) {
      const remove = el('button', { class: 'cw-arg-remove', text: '×', title: `Remove ${arg.label}` });
      remove.type = 'button';
      remove.addEventListener('click', () => opts.onArgEdit({ id: card.id, op: 'remove', argIndex }));
      row.append(remove);
    }

    panel.append(row);
  });

  // Add-optional-argument: offer any optional emit arg not already present
  // (matched positionally — an emit arg is "present" if the card already renders
  // an arg at its position). On pick, emit an `add` with the placeholder source.
  if (opts.editing) {
    const addControl = buildAddArg(card, opts);
    if (addControl !== null) {
      panel.append(addControl);
    }
  }

  return panel;
}

/** A `<select>` of sibling methods; `change` emits an `op: 'method'` intent. */
function buildMethodSelect(
  card: CwActivityCard,
  methods: string[],
  opts: PropertiesPanelOptions
): HTMLElement {
  const row = el('div', { class: 'cw-props-row' }, [
    el('label', { class: 'cw-props-label', text: 'Method' })
  ]);
  const select = document.createElement('select');
  select.className = 'cw-method-select';
  for (const m of methods) {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m;
    if (m === card.method) {
      option.selected = true;
    }
    select.append(option);
  }
  select.addEventListener('change', () => {
    if (select.value !== card.method) {
      opts.onArgEdit({ id: card.id, op: 'method', newMethod: select.value });
    }
  });
  row.append(select);
  return row;
}

/**
 * A `<select>` of optional emit args not yet on the card; picking one emits an
 * `op: 'add'` with the arg's placeholder source. Returns null when the call is
 * uncataloged or every optional arg is already present.
 */
function buildAddArg(card: CwActivityCard, opts: PropertiesPanelOptions): HTMLElement | null {
  const emitArgs = emitArgsFor(card);
  // Match by IDENTITY: an emit arg is "present" if the card already renders a
  // rendered arg whose label matches the emit arg's label at the same position.
  // Positional count matching (`position >= card.args.length`) misfires when a
  // call omits an earlier optional arg but supplies a later one, so we compare
  // each slot by its label instead.
  const renderedLabels = new Set(card.args.map((a) => a.label));
  const addable = emitArgs
    .map((spec, position) => ({ spec, position }))
    .filter(({ spec }) => spec.required === false && !renderedLabels.has(spec.label));
  if (addable.length === 0) {
    return null;
  }
  const row = el('div', { class: 'cw-arg-add' }, [
    el('label', { class: 'cw-props-label', text: 'Add argument' })
  ]);
  const select = document.createElement('select');
  select.className = 'cw-arg-add-select';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '…';
  select.append(blank);
  for (const { spec } of addable) {
    const option = document.createElement('option');
    option.value = spec.label;
    option.textContent = spec.label;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const picked = addable.find(({ spec }) => spec.label === select.value);
    if (picked !== undefined) {
      opts.onArgEdit({ id: card.id, op: 'add', newText: picked.spec.placeholder ?? '' });
    }
    select.value = '';
  });
  row.append(select);
  return row;
}
