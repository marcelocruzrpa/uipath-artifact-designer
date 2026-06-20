/**
 * The insertion palette — a small searchable popover listing every addable
 * statement (catalog activities + Assign / Add item + the raw escape), built
 * from the pure `PALETTE_ITEMS`. Picking an item calls `onPick` with its id;
 * the renderer then collects arg values, emits the statement source via
 * `emitStatement`, and posts an `addStatement` intent. No innerHTML — `el` and
 * `replaceChildren` only.
 */
import { el } from '../../util';
import { PALETTE_ITEMS, type PaletteItem } from '../../../src/model/codedWorkflow/edit/editCatalog';

export interface PaletteOptions {
  /** Called with the picked palette item id. */
  onPick: (id: string) => void;
}

/** A searchable list of addable statements. */
export function renderPalette(opts: PaletteOptions): HTMLElement {
  const root = el('div', { class: 'cw-pal' });
  const search = document.createElement('input');
  search.className = 'cw-pal-search';
  search.type = 'text';
  search.placeholder = 'Search activities…';
  const list = el('div', { class: 'cw-pal-list' });

  const renderList = (query: string): void => {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = PALETTE_ITEMS.filter(
      (it) => q === '' || it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))
    );
    for (const item of matches) {
      const row = el('button', { class: 'cw-pal-item', text: item.label, title: item.label });
      row.type = 'button';
      row.addEventListener('click', () => opts.onPick(item.id));
      list.append(row);
    }
  };

  search.addEventListener('input', () => renderList(search.value));
  renderList('');
  root.append(search, list);
  return root;
}

/** Re-export for callers that build an arg form from the picked item. */
export type { PaletteItem };
