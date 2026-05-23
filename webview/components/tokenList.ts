/** Renders an agent message's contentTokens with variables shown as chips. */
import type { AgentMessage } from '../../src/model/types';
import { el } from '../util';

export function renderTokens(message: AgentMessage | undefined): HTMLElement {
  const block = el('div', { class: 'prompt-block' });
  if (!message) {
    block.append(el('p', { class: 'muted-note', text: 'Not set.' }));
    return block;
  }

  const tokens = message.contentTokens;
  if (!tokens || tokens.length === 0) {
    // Fall back to the raw content string.
    block.append(el('span', { class: 'prompt-text', text: message.content || '(empty)' }));
    return block;
  }

  for (const token of tokens) {
    if (token.type === 'variable') {
      block.append(el('span', { class: 'var-chip', text: token.rawString, title: 'Variable' }));
    } else {
      block.append(el('span', { class: 'prompt-text', text: token.rawString }));
    }
  }
  return block;
}
