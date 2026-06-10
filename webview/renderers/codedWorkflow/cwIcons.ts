/**
 * Coded-workflow canvas icons, built as real SVG DOM (no innerHTML / HTML
 * strings — the shape data below are trusted constants), following the
 * `components/icons.ts` conventions.
 *
 * Keys cover BOTH the icon ids the model emits (tier-1 catalog: `gear`,
 * `window`, `type-hierarchy`, … and tier-2 families: `arrow-right`,
 * `symbol-string`, …) and the service-family aliases (`system`,
 * `uiAutomation`, …) so either id scheme resolves to a glyph. Unknown names
 * fall back to a generic box.
 */
import { svgEl } from '../../util';

type Shape = [tag: string, attrs: Record<string, string | number>];

const ICONS: Record<string, Shape[]> = {
  // --- canvas header -------------------------------------------------------
  workflow: [
    ['path', { d: 'M5 4.5l7 7.5-7 7.5z' }],
    ['path', { d: 'M14 8.5l3.5 3.5-3.5 3.5-3.5-3.5z' }]
  ],

  // --- tier-1 service glyphs (model icon ids) ------------------------------
  gear: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    [
      'path',
      {
        d:
          'M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4' +
          'M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18'
      }
    ]
  ],
  window: [
    ['rect', { x: 3.5, y: 5, width: 17, height: 13, rx: 2 }],
    ['path', { d: 'M3.5 9h17' }],
    ['path', { d: 'M12 12l4.5 2-2 .8-.8 2z' }]
  ],
  'type-hierarchy': [
    ['rect', { x: 9, y: 3.5, width: 6, height: 4.5, rx: 1 }],
    ['rect', { x: 3.5, y: 16, width: 6, height: 4.5, rx: 1 }],
    ['rect', { x: 14.5, y: 16, width: 6, height: 4.5, rx: 1 }],
    ['path', { d: 'M12 8v4M12 12H6.5v4M12 12h5.5v4' }]
  ],
  plug: [
    ['path', { d: 'M9 2.5v5.5M15 2.5v5.5' }],
    ['path', { d: 'M7 8h10v3a5 5 0 0 1-10 0z' }],
    ['path', { d: 'M12 16v5.5' }]
  ],
  table: [
    ['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 1.5 }],
    ['path', { d: 'M3.5 9.5h17M9 9.5v10M15 9.5v10' }]
  ],
  file: [
    ['path', { d: 'M7 3h7l4 4v14H7z' }],
    ['path', { d: 'M14 3v4h4' }],
    ['path', { d: 'M9.5 12h5M9.5 15.5h5' }]
  ],
  'file-media': [
    ['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 1.5 }],
    ['path', { d: 'M10 9.5l5 2.5-5 2.5z' }]
  ],
  'cloud-upload': [
    ['path', { d: 'M3 14a5 5 0 0 1 12-3 4 4 0 0 1 0 8H7a4 4 0 0 1-4-5z' }],
    ['path', { d: 'M12 19v-6M9.5 15.5L12 13l2.5 2.5' }]
  ],
  database: [
    ['ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }],
    ['path', { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }],
    ['path', { d: 'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' }]
  ],
  key: [
    ['circle', { cx: 8, cy: 14, r: 4 }],
    ['path', { d: 'M11 11l8.5-8.5M16 6l3 3M13.5 8.5l2 2' }]
  ],
  beaker: [
    ['path', { d: 'M9.5 3h5M10.5 3v5.5L5 18a2.2 2.2 0 0 0 2 3h10a2.2 2.2 0 0 0 2-3l-5.5-9.5V3' }],
    ['path', { d: 'M7.5 15h9' }]
  ],
  coffee: [
    ['path', { d: 'M5 9h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z' }],
    ['path', { d: 'M16 10.5h2a2.5 2.5 0 0 1 0 5h-2' }],
    ['path', { d: 'M8.5 3.5c-1 1.2 1 1.8 0 3M12.5 3.5c-1 1.2 1 1.8 0 3' }]
  ],
  code: [
    ['path', { d: 'M5 5.5c5-3 9 2.5 4 4.5s-9 5 4 3.5' }],
    ['path', { d: 'M5 18.5c4.5 2 9.5 1 14-1' }]
  ],
  'play-circle': [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M10 8.5l5.5 3.5-5.5 3.5z' }]
  ],

  // --- tier-2 family glyphs (model icon ids) --------------------------------
  'arrow-right': [['path', { d: 'M4 12h15M14 7l5 5-5 5' }]],
  'symbol-string': [
    ['path', { d: 'M8.5 9.5h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v-7zM8.5 9.5v7' }],
    ['path', { d: 'M14 9.5h2.5a2 2 0 0 1 2 2v5h-3.5a2 2 0 0 1 0-4h3.5' }]
  ],
  filter: [['path', { d: 'M4 5h16l-6.2 7.2V19l-3.6-2v-4.8z' }]],
  'list-ordered': [
    ['path', { d: 'M10 6h10M10 12h10M10 18h10' }],
    ['path', { d: 'M4 5l1.5-1v4M3.8 11h2.4l-2.4 3h2.4M3.8 16.5h2c.8 0 .8 1.5 0 1.5.8 0 .8 1.5 0 1.5h-2' }]
  ],
  calendar: [
    ['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2 }],
    ['path', { d: 'M3.5 9.5h17M8 3v4M16 3v4' }]
  ],
  terminal: [
    ['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }],
    ['path', { d: 'M7 9l3.5 3L7 15M12.5 15.5h4.5' }]
  ],
  fx: [
    ['path', { d: 'M11 5.5h-1.5a2 2 0 0 0-2 2V18M5.5 11H10' }],
    ['path', { d: 'M13 11l5.5 7M18.5 11L13 18' }]
  ],

  // --- chevrons -------------------------------------------------------------
  'chevron-right': [['path', { d: 'M9.5 6.5l5.5 5.5-5.5 5.5' }]],
  'chevron-down': [['path', { d: 'M6.5 9.5l5.5 5.5 5.5-5.5' }]],

  // --- container glyphs -------------------------------------------------------
  if: [
    ['path', { d: 'M12 3.5L20.5 12 12 20.5 3.5 12z' }],
    ['path', { d: 'M10.2 9.8a1.9 1.9 0 0 1 3.6.6c0 1.3-1.8 1.6-1.8 2.9' }],
    ['circle', { cx: 12, cy: 15.8, r: 0.7 }]
  ],
  loop: [
    ['path', { d: 'M5.5 12a6.5 6.5 0 0 1 11-4.7' }],
    ['path', { d: 'M16.5 3.5v4h-4' }],
    ['path', { d: 'M18.5 12a6.5 6.5 0 0 1-11 4.7' }],
    ['path', { d: 'M7.5 20.5v-4h4' }]
  ],
  try: [
    ['path', { d: 'M12 3l7.5 3v6c0 4.4-3.1 7.6-7.5 9-4.4-1.4-7.5-4.6-7.5-9V6z' }],
    ['path', { d: 'M9 12l2.2 2.2L15.5 9.5' }]
  ],
  switch: [
    ['path', { d: 'M12 20.5v-8M12 12.5L6 7M12 12.5l6-5.5' }],
    ['circle', { cx: 5.5, cy: 5.5, r: 1.8 }],
    ['circle', { cx: 18.5, cy: 5.5, r: 1.8 }],
    ['circle', { cx: 12, cy: 12.5, r: 1 }]
  ],
  using: [
    ['path', { d: 'M9.5 3.5H8a2.5 2.5 0 0 0-2.5 2.5v3.5L3.5 12l2 2.5V18A2.5 2.5 0 0 0 8 20.5h1.5' }],
    ['path', { d: 'M14.5 3.5H16a2.5 2.5 0 0 1 2.5 2.5v3.5l2 2.5-2 2.5V18a2.5 2.5 0 0 1-2.5 2.5h-1.5' }]
  ],

  // --- generic fallback -------------------------------------------------------
  _box: [
    ['path', { d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' }],
    ['path', { d: 'M4 7.5l8 4.5 8-4.5M12 12v9' }]
  ]
};

/** Service-family ids → the catalog icon id they render with. */
const ALIASES: Record<string, string> = {
  system: 'gear',
  uiAutomation: 'window',
  workflows: 'type-hierarchy',
  connections: 'plug',
  excel: 'table',
  word: 'file',
  powerpoint: 'file-media',
  ftp: 'cloud-upload',
  credentials: 'key',
  testing: 'beaker',
  java: 'coffee',
  python: 'code',
  _base: 'play-circle'
};

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function shapesFor(name: string): Shape[] {
  // Own-property checks so a hostile/odd name ("constructor", …) cannot
  // walk the prototype chain and return a non-Shape value.
  if (hasOwn(ICONS, name)) {
    return ICONS[name];
  }
  if (hasOwn(ALIASES, name) && hasOwn(ICONS, ALIASES[name])) {
    return ICONS[ALIASES[name]];
  }
  return ICONS._box;
}

/** Builds a fresh <svg> icon for the given name; unknown names get a box. */
export function cwIcon(name: string): SVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  });
  for (const [tag, attrs] of shapesFor(name)) {
    svg.append(svgEl(tag, attrs));
  }
  return svg;
}
