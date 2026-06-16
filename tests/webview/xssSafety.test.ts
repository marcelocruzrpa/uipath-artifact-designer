// @vitest-environment jsdom
/**
 * XSS regression: the coded-workflow webview builders MUST treat every
 * model-derived string (card title / arg value / chip code / container header /
 * slot label) as TEXT, never HTML.  All builders go through `el({ text })` →
 * `textContent` and `pre.textContent` — no `innerHTML` anywhere — so an
 * `<script>` / `<img onerror>` payload that survived classification verbatim
 * renders as inert text, not a live element.
 *
 * Each case renders a real DOM via the actual builders and asserts:
 *   1. NO `<script>` or `<img>` element exists anywhere under the root (the
 *      payload was not parsed as markup), and
 *   2. the payload survives verbatim as the node's `textContent` (honesty —
 *      the dangerous code is shown to the user, not silently dropped).
 */
import { describe, it, expect } from 'vitest';
import { buildActivityCard, buildChip } from '../../webview/renderers/codedWorkflow/stepCard';
import { buildContainer } from '../../webview/renderers/codedWorkflow/containers';
import type {
  CwActivityCard,
  CwContainer,
  CwRawChip,
  SourceSpan
} from '../../src/model/codedWorkflow/cwTypes';
import type { RenderCtx } from '../../webview/renderers/codedWorkflow/containers';

const SPAN: SourceSpan = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SCRIPT_PAYLOAD = '<script>alert(1)</script>';
const IMG_PAYLOAD = '</pre><img src=x onerror=alert(1)>';

/** A root with the rendered node attached, so querySelector sees the subtree. */
function mount(node: HTMLElement): HTMLElement {
  const root = document.createElement('div');
  root.appendChild(node);
  return root;
}

/** No live script/img element was created from a model string. */
function assertNoInjectedElements(root: HTMLElement): void {
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('img')).toBeNull();
}

describe('coded-workflow webview XSS safety', () => {
  it('renders a card title payload as inert text', () => {
    const card: CwActivityCard = {
      id: 'x', span: SPAN, type: 'activity', tier: 1,
      service: '_base', serviceDisplayName: 'Workflow',
      method: 'Log', title: SCRIPT_PAYLOAD, args: [], icon: 'log'
    };
    const root = mount(buildActivityCard(card));
    assertNoInjectedElements(root);
    const title = root.querySelector('.cw-card-title')!;
    expect(title.textContent).toBe(SCRIPT_PAYLOAD);
    // The payload contributed no element children (pure text node).
    expect(title.querySelector('*')).toBeNull();
  });

  it('renders a card arg value payload as inert text', () => {
    const card: CwActivityCard = {
      id: 'x', span: SPAN, type: 'activity', tier: 1,
      service: '_base', serviceDisplayName: 'Workflow',
      method: 'Log', title: 'Log', icon: 'log',
      args: [{ label: 'message', value: IMG_PAYLOAD, kind: 'literal', editableKind: 'string' }]
    };
    const root = mount(buildActivityCard(card));
    assertNoInjectedElements(root);
    const value = root.querySelector('.cw-arg-value')!;
    expect(value.textContent).toBe(IMG_PAYLOAD);
  });

  it('renders chip code payload as inert text inside <pre>', () => {
    const chip: CwRawChip = {
      id: 'x', span: SPAN, type: 'raw', tier: 3,
      code: IMG_PAYLOAD, lineCount: 1, statementCount: 1, codeTruncated: false
    };
    // Expanded (collapsed=false) so the <pre> with the code is rendered.
    const root = mount(buildChip(chip, false, () => {}));
    assertNoInjectedElements(root);
    const pre = root.querySelector('pre.cw-chip-code')!;
    expect(pre.textContent).toBe(IMG_PAYLOAD);
    expect(pre.querySelector('*')).toBeNull();
  });

  it('renders a container header payload as inert text', () => {
    const container: CwContainer = {
      id: 'x', span: SPAN, type: 'container', kind: 'if',
      header: SCRIPT_PAYLOAD, collapsedByDefault: false,
      slots: [{ role: 'then', label: IMG_PAYLOAD, children: [], span: SPAN, braced: true }]
    };
    const ctx: RenderCtx = {
      depth: 0,
      isCollapsed: () => false,
      onToggle: () => {},
      editing: false,
      onInsert: () => {},
      onDelete: () => {},
      onMove: () => {},
      slot: { containerId: '', methodId: 'W#Execute/' }
    };
    const root = mount(buildContainer(container, ctx));
    assertNoInjectedElements(root);
    const title = root.querySelector('.cw-ct-title')!;
    expect(title.textContent).toBe(SCRIPT_PAYLOAD);
    // The slot label payload is also inert text.
    const label = root.querySelector('.cw-branch-label')!;
    expect(label.textContent).toBe(IMG_PAYLOAD);
  });
});
