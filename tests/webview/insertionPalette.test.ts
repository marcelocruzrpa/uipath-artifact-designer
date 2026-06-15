// @vitest-environment jsdom
/**
 * L2 tests: the insertion palette — a searchable list of addable statements
 * built from `PALETTE_ITEMS`. Picking an item emits its palette id; the host
 * (via the renderer) then builds the statement source through `emitStatement`
 * and posts an `addStatement` intent. NO innerHTML anywhere (el/replaceChildren).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderPalette } from '../../webview/renderers/codedWorkflow/insertionPalette';
import { findPaletteItem } from '../../src/model/codedWorkflow/edit/editCatalog';

describe('renderPalette', () => {
  it('lists palette items and filters by query', () => {
    const root = document.createElement('div');
    root.appendChild(renderPalette({ onPick: () => {} }));
    const items = root.querySelectorAll('.cw-pal-item');
    expect(items.length).toBeGreaterThan(0);
    const search = root.querySelector('input.cw-pal-search') as HTMLInputElement;
    search.value = 'queue';
    search.dispatchEvent(new Event('input'));
    const labels = Array.from(root.querySelectorAll('.cw-pal-item')).map((n) => n.textContent);
    expect(labels.some((l) => l?.includes('Add Queue Item'))).toBe(true);
    expect(labels.some((l) => l === 'Log')).toBe(false);
  });

  it('emits the picked item id', () => {
    const onPick = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPalette({ onPick }));
    const log = Array.from(root.querySelectorAll<HTMLElement>('.cw-pal-item')).find((n) => n.textContent === 'Log')!;
    log.click();
    expect(onPick).toHaveBeenCalledWith('catalog:_base.Log');
  });

  // Fence F (honesty): the raw escape carries NO typed arg schema, so it can only
  // ever become a free-text statement (→ a tier-3 chip), never field-edited.
  it('exposes the raw escape with an empty arg schema (no typed fields)', () => {
    const raw = findPaletteItem('raw');
    expect(raw).not.toBeNull();
    expect(raw!.kind).toBe('raw');
    expect(raw!.args).toEqual([]);
  });
});
