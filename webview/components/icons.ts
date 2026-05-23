/**
 * Node-kind icons, built as real SVG DOM (no innerHTML / HTML strings).
 * The shape data below are trusted constants.
 */
import type { NodeKind } from '../../src/model/types';
import { svgEl } from '../util';

type Shape = [tag: string, attrs: Record<string, string | number>];

const ICONS: Record<string, Shape[]> = {
  agent: [
    ['rect', { x: 4, y: 7, width: 16, height: 12, rx: 3 }],
    ['circle', { cx: 9.5, cy: 13, r: 1.4 }],
    ['circle', { cx: 14.5, cy: 13, r: 1.4 }],
    ['path', { d: 'M12 3.5v3.5' }],
    ['circle', { cx: 12, cy: 3, r: 1.1 }]
  ],
  'tool-process': [
    ['circle', { cx: 6, cy: 6, r: 2.2 }],
    ['circle', { cx: 18, cy: 6, r: 2.2 }],
    ['circle', { cx: 12, cy: 18, r: 2.2 }],
    ['path', { d: 'M6 8.2v1.6a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V8.2' }],
    ['path', { d: 'M12 13.8v2' }]
  ],
  'tool-integration': [
    ['path', { d: 'M9 2.5v5.5M15 2.5v5.5' }],
    ['path', { d: 'M7 8h10v3a5 5 0 0 1-10 0z' }],
    ['path', { d: 'M12 16v5.5' }]
  ],
  'tool-builtin': [['path', { d: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z' }]],
  'context-index': [
    ['ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }],
    ['path', { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }],
    ['path', { d: 'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' }]
  ],
  'context-attachments': [
    ['path', { d: 'M16.5 7.5l-7 7a3 3 0 1 0 4.2 4.2l7.3-7.3a5 5 0 0 0-7-7L6.6 11.6' }]
  ],
  'context-datafabric': [
    ['rect', { x: 4, y: 4, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 13, y: 4, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 4, y: 13, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 13, y: 13, width: 7, height: 7, rx: 1.5 }]
  ],
  escalation: [
    ['path', { d: 'M18 15.5V11a6 6 0 1 0-12 0v4.5L4 18h16z' }],
    ['path', { d: 'M10 18a2 2 0 0 0 4 0' }]
  ],
  memory: [
    ['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }],
    ['rect', { x: 10, y: 10, width: 4, height: 4, rx: 1 }],
    ['path', { d: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3' }]
  ],
  unknown: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.3-2.5 4' }],
    ['circle', { cx: 12, cy: 17, r: 0.8 }]
  ]
};

function shapesFor(kind: string): Shape[] {
  if (ICONS[kind]) {
    return ICONS[kind];
  }
  if (kind === 'tool-unknown') {
    return ICONS['tool-process'];
  }
  if (kind === 'context-unknown') {
    return ICONS['context-index'];
  }
  return ICONS.unknown;
}

/** Builds a fresh <svg> icon element for the given node kind. */
export function nodeIcon(kind: NodeKind | 'agent'): SVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  });
  for (const [tag, attrs] of shapesFor(kind)) {
    svg.append(svgEl(tag, attrs));
  }
  return svg;
}
