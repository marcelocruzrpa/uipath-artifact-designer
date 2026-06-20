// @vitest-environment jsdom
/**
 * A11y: the leaf card builders carry a concise, textContent-only `aria-label`
 * so a screen reader announces what the card is (title + service/method/text),
 * matching what is shown on screen. No HTML is interpolated into the label.
 */
import { describe, it, expect } from 'vitest';
import { buildActivityCard, buildPseudoCard } from '../../webview/renderers/codedWorkflow/stepCard';
import type {
  CwActivityCard,
  CwPseudoStep,
  SourceSpan
} from '../../src/model/codedWorkflow/cwTypes';

const SPAN: SourceSpan = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

describe('card aria-label', () => {
  it('summarizes an activity card by title, service and its args', () => {
    const card: CwActivityCard = {
      id: 'a', span: SPAN, type: 'activity', tier: 1,
      service: 'queues', serviceDisplayName: 'Queues',
      method: 'AddQueueItem', title: 'Add Queue Item', icon: 'queue',
      args: [{ label: 'queue', value: 'MyQueue', kind: 'literal', editableKind: 'string' }],
      resultBinding: 'item'
    };
    const label = buildActivityCard(card).getAttribute('aria-label') ?? '';
    expect(label).toContain('Add Queue Item');
    expect(label).toContain('Queues');
    expect(label).toContain('queue: MyQueue');
    expect(label).toContain('→ item');
  });

  it('summarizes a pseudo-step by its title and text', () => {
    const step: CwPseudoStep = {
      id: 'p', span: SPAN, type: 'pseudo', tier: 2,
      ruleId: 'assign', title: 'Assign', text: 'total = a + b', icon: 'fx'
    };
    const label = buildPseudoCard(step).getAttribute('aria-label') ?? '';
    expect(label).toContain('Assign');
    expect(label).toContain('total = a + b');
  });
});
