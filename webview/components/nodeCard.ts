/** Builds the agent card, circular resource nodes, and lane junction pucks. */
import type { AgentModel, NodeKind, ResourceNode } from '../../src/model/types';
import { el } from '../util';
import { nodeIcon } from './icons';

const KIND_LABELS: Record<NodeKind, string> = {
  'tool-process': 'Process tool',
  'tool-integration': 'Integration Service tool',
  'tool-builtin': 'Built-in tool',
  'tool-unknown': 'Tool',
  'context-index': 'Context · Index',
  'context-attachments': 'Context · Attachments',
  'context-datafabric': 'Context · Data Fabric',
  'context-unknown': 'Context',
  escalation: 'Escalation',
  memory: 'Memory',
  unknown: 'Resource'
};

export function kindLabel(kind: NodeKind): string {
  return KIND_LABELS[kind] ?? 'Resource';
}

/** Builds an icon element; prefers the remote connector icon for integration tools. */
function buildIcon(
  parent: HTMLElement,
  kind: NodeKind | 'agent',
  iconUrl: string | undefined
): void {
  if (iconUrl) {
    const img = el('img', { class: 'node-icon-img' });
    img.src = iconUrl;
    img.alt = '';
    img.addEventListener('error', () => {
      img.remove();
      parent.append(nodeIcon(kind));
    });
    parent.append(img);
  } else {
    parent.append(nodeIcon(kind));
  }
}

export function createAgentCard(model: AgentModel): HTMLElement {
  const card = el('div', { class: 'node node--agent' });
  card.dataset.kind = 'agent';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Agent: ${model.projectName}`);
  card.setAttribute('aria-selected', 'false');

  const icon = el('div', { class: 'node-icon' });
  buildIcon(icon, 'agent', undefined);
  card.append(
    el('div', { class: 'node-head' }, [
      icon,
      el('div', { class: 'node-headings' }, [
        el('div', { class: 'node-title', text: model.projectName, title: model.projectName }),
        el('div', {
          class: 'agent-sub',
          text: model.isInlineInFlow ? 'Inline-in-flow agent' : 'Low-code agent'
        })
      ]),
      el('span', { class: 'node-tag', text: 'AGENT' })
    ])
  );

  card.append(el('div', { class: 'agent-model', text: model.settings.model ?? 'model not set' }));

  const systemMessage = model.messages.find((m) => m.role === 'system');
  const preview = (systemMessage?.content ?? '').trim();
  card.append(
    el('div', { class: 'agent-instr' }, [
      el('div', { class: 'agent-instr-label', text: 'Instructions' }),
      el('div', {
        class: 'agent-instr-text',
        text: preview.length > 0 ? preview : 'No system prompt.'
      })
    ])
  );

  return card;
}

export function createResourceNode(node: ResourceNode): HTMLElement {
  const wrap = el('div', { class: 'node rnode' });
  wrap.dataset.kind = node.kind;
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('aria-label', `${kindLabel(node.kind)}: ${node.name}`);
  wrap.setAttribute('aria-selected', 'false');
  if (!node.enabled) {
    wrap.classList.add('rnode--disabled');
  }

  const circle = el('div', { class: 'rnode-circle' });
  const iconUrl = node.kind === 'tool-integration' ? node.iconUrl : undefined;
  buildIcon(circle, node.kind, iconUrl);

  const hasWarning = !node.enabled || node.badges.some((b) => b.tone === 'warn');
  if (hasWarning) {
    circle.append(
      el('span', { class: 'rnode-warn', text: '!', title: 'Has a warning — open for details' })
    );
  }

  wrap.append(circle);
  wrap.append(el('div', { class: 'rnode-label', text: node.name, title: node.name }));
  return wrap;
}

/** Builds the labelled junction puck shown between the agent and a lane's nodes. */
export function createJunction(label: string, count: number, group: string): HTMLElement {
  const junction = el('div', { class: 'junction' });
  junction.dataset.lane = group;
  junction.append(el('span', { class: 'junction-count', text: String(count) }));
  junction.append(el('span', { class: 'junction-label', text: label }));
  return junction;
}
