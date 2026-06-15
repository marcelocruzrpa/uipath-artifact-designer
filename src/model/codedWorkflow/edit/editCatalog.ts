// src/model/codedWorkflow/edit/editCatalog.ts
// PURITY: pure data + a flatten function. web-tree-sitter-FREE so it is safe
// for the webview bundle (added to tsconfig.webview.json include).
import { TIER1_CATALOG, BASE_FAMILY_ID, type CatalogEmitArg } from '../classify/tier1Catalog';

/** One addable palette entry. */
export interface PaletteItem {
  /** Stable palette id: `catalog:<service>.<method>` | `step:assign` | `step:add-item` | `raw`. */
  id: string;
  /** Display label in the palette. */
  label: string;
  /** Search keywords (lower-cased). */
  keywords: string[];
  /** Argument schema to fill before emit; empty for the raw escape. */
  args: CatalogEmitArg[];
  /** True when a result binding name should be offered. */
  returnsValue?: boolean;
  /** Kind, so the emitter dispatches: a catalog call, a fixed step, or raw text. */
  kind: 'catalog' | 'assign' | 'add-item' | 'raw';
  /** For 'catalog': the service receiver (`system`) or '' for base; the emit template. */
  recv?: string;
  template?: string;
}

const ASSIGN_ITEM: PaletteItem = {
  id: 'step:assign',
  label: 'Assign',
  keywords: ['assign', 'set', 'variable', 'let'],
  args: [
    { label: 'Variable', kind: 'identifier', placeholder: 'value' },
    { label: 'Value', kind: 'raw', placeholder: '0' }
  ],
  kind: 'assign'
};

const ADD_ITEM: PaletteItem = {
  id: 'step:add-item',
  label: 'Add item',
  keywords: ['add', 'item', 'list', 'collection', 'append'],
  args: [
    { label: 'Collection', kind: 'identifier', placeholder: 'items' },
    { label: 'Item', kind: 'raw', placeholder: 'item' }
  ],
  kind: 'add-item'
};

const RAW_ITEM: PaletteItem = {
  id: 'raw',
  label: 'Raw code…',
  keywords: ['raw', 'code', 'custom', 'escape', 'csharp', 'c#'],
  args: [],
  kind: 'raw'
};

/** All palette items: cataloged emit entries first, then the fixed steps + raw. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  ...TIER1_CATALOG.flatMap((family) =>
    family.entries
      .filter((e) => e.emit !== undefined)
      .map((e): PaletteItem => ({
        id: `catalog:${family.id}.${e.method}`,
        label: e.title,
        keywords: [e.title.toLowerCase(), e.method.toLowerCase(), family.displayName.toLowerCase()],
        args: e.emit!.args,
        returnsValue: e.emit!.returnsValue,
        kind: 'catalog',
        recv: family.id === BASE_FAMILY_ID ? '' : family.id,
        template: e.emit!.template
      }))
  ),
  ASSIGN_ITEM,
  ADD_ITEM,
  RAW_ITEM
];

/** Look up a palette item by id; null when unknown. */
export function findPaletteItem(id: string): PaletteItem | null {
  return PALETTE_ITEMS.find((p) => p.id === id) ?? null;
}
