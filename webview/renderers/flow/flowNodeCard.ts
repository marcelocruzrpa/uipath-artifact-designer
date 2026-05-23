/**
 * Builds a flow node card — an absolutely-positioned DOM box, one per
 * {@link FlowNode}, styled by the node's {@link FlowNodeKind}.
 */
import type { FlowNode, FlowNodeKind } from '../../../src/model/types';
import { el } from '../../util';

/** Short human label for each node kind, shown as the card's type tag. */
const KIND_LABELS: Record<FlowNodeKind, string> = {
  trigger: 'Trigger',
  action: 'Action',
  decision: 'Decision',
  switch: 'Switch',
  loop: 'Loop',
  merge: 'Merge',
  end: 'End',
  terminate: 'Terminate',
  connector: 'Connector',
  agent: 'Agent',
  subflow: 'Subflow',
  unknown: 'Node'
};

/** A single Unicode glyph per node kind — no icon-font dependency. */
const KIND_GLYPHS: Record<FlowNodeKind, string> = {
  trigger: '▶',
  action: '⚙',
  decision: '◇',
  switch: '⑂',
  loop: '↻',
  merge: '⩓',
  end: '●',
  terminate: '■',
  connector: '⬢',
  agent: '✱',
  subflow: '▦',
  unknown: '○'
};

/** Returns the human label for a node kind. */
export function flowKindLabel(kind: FlowNodeKind): string {
  return KIND_LABELS[kind] ?? 'Node';
}

/**
 * Builds the DOM card for one flow node. The caller positions and sizes the
 * returned element absolutely on the canvas node layer.
 */
export function createFlowNodeCard(node: FlowNode): HTMLElement {
  const card = el('div', { class: 'flow-node' });
  card.dataset.flowKind = node.kind;
  card.dataset.nodeId = node.id;
  card.tabIndex = 0;
  card.title = `${node.label} — ${node.type}`;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${flowKindLabel(node.kind)}: ${node.label}`);
  card.setAttribute('aria-selected', 'false');

  const head = el('div', { class: 'flow-node-head' }, [
    el('span', { class: 'flow-node-glyph', text: KIND_GLYPHS[node.kind] ?? KIND_GLYPHS.unknown }),
    el('span', { class: 'flow-node-tag', text: flowKindLabel(node.kind) })
  ]);
  card.append(head);

  card.append(
    el('div', { class: 'flow-node-label', text: node.label, title: node.label })
  );
  card.append(el('div', { class: 'flow-node-type', text: node.type }));

  return card;
}
