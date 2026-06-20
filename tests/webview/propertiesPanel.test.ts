// @vitest-environment jsdom
/**
 * Stage-L0 tests: the coded-workflow properties panel — a docked inspector
 * that, in edit mode, edits the RAW source token of an activity card's args
 * and emits an editValue intent on change. In read-only mode every field is
 * disabled (pure inspector); `editableKind: 'none'` args and args without a
 * backing token (`valueRaw === undefined`) are always disabled.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  renderPropertiesPanel,
  renderPseudoPanel
} from '../../webview/renderers/codedWorkflow/propertiesPanel';
import type { CwActivityCard, CwPseudoStep } from '../../src/model/codedWorkflow/cwTypes';

function card(): CwActivityCard {
  return {
    id: 'W#Execute/0',
    type: 'activity',
    tier: 1,
    service: '_base',
    serviceDisplayName: 'Workflow',
    method: 'Log',
    title: 'Log',
    icon: 'play-circle',
    span: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    args: [
      {
        label: 'Message',
        value: 'hi',
        kind: 'literal',
        editableKind: 'string',
        valueRaw: '"hi"',
        valueSpan: { start: 1, end: 5 }
      }
    ]
  };
}

describe('renderPropertiesPanel', () => {
  it('shows the card title', () => {
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    expect(root.textContent).toContain('Log');
  });

  it('associates each label with its control (a11y: label.htmlFor === control.id)', () => {
    const root = document.createElement('div');
    // Every label in the panel must point at (or wrap) a real control: at least
    // the arg-row <input>, plus the Method/Add-argument <select>s when present.
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    const labels = Array.from(root.querySelectorAll('label')) as HTMLLabelElement[];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // Either the label points at a control by id, or it wraps the control.
      const byFor = label.htmlFor !== '' ? root.querySelector(`#${label.htmlFor}`) : null;
      const wrapped = label.querySelector('input, select, textarea');
      const associated = (byFor !== null && byFor.id === label.htmlFor) || wrapped !== null;
      expect(associated).toBe(true);
    }
    // The arg input specifically is reachable from its label's htmlFor.
    const input = root.querySelector('input.cw-props-input') as HTMLInputElement;
    const inputLabel = Array.from(labels).find((l) => l.htmlFor === input.id);
    expect(inputLabel).toBeDefined();
    expect(input.id).not.toBe('');
  });

  it('mints unique control ids across multiple arg rows (no duplicate-id collisions)', () => {
    const c = card();
    c.args = [
      { label: 'A', value: 'x', kind: 'identifier', editableKind: 'identifier', valueRaw: 'x', valueSpan: { start: 1, end: 2 } },
      { label: 'B', value: 'y', kind: 'identifier', editableKind: 'identifier', valueRaw: 'y', valueSpan: { start: 4, end: 5 } }
    ];
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    const ids = Array.from(root.querySelectorAll('input, select')).map((n) => (n as HTMLElement).id);
    expect(ids.every((id) => id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds a string input to the unquoted CONTENT, not the raw token', () => {
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    // editableKind 'string' shows the content ('hi'), NOT the raw token ('"hi"');
    // the host owns the quotes so the user edits the message text only.
    expect(input.value).toBe('hi');
    expect(input.value).not.toBe('"hi"');
  });

  it('edits a string field and emits its CONTENT as newText on change', () => {
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit, onArgEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('hi');
    // The user types the message text with no quotes; the host re-quotes it.
    input.value = 'bye';
    input.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', argIndex: 0, newText: 'bye' });
  });

  it('disables fields in read-only mode', () => {
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: false, onEdit: () => {}, onArgEdit: () => {} }));
    expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('does not emit when a disabled (read-only) field receives a change event', () => {
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: false, onEdit, onArgEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = '"bye"';
    input.dispatchEvent(new Event('change'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps `editableKind: none` args disabled even in edit mode', () => {
    const c = card();
    c.args = [
      {
        label: 'Options',
        value: 'SaveChanges: true',
        kind: 'expression',
        editableKind: 'none'
        // no valueSpan / valueRaw — synthesized summary
      }
    ];
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('disables an editable-kind arg that has no backing token (valueRaw undefined)', () => {
    const c = card();
    c.args = [
      {
        label: 'Target',
        value: 'foo.Bar',
        kind: 'target',
        editableKind: 'enum'
        // valueRaw undefined: a truncated chain tail is not inline-editable
      }
    ];
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    // falls back to the display value when there is no raw token
    expect(input.value).toBe('foo.Bar');
  });

  it('marks raw-expression args with an explanatory title but keeps them editable', () => {
    const c = card();
    c.args = [
      {
        label: 'Message',
        value: 'done with {x}',
        kind: 'interpolated',
        editableKind: 'raw',
        valueRaw: '$"done with {x}"',
        valueSpan: { start: 1, end: 17 }
      }
    ];
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit, onArgEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.title).toBe('expression — edited as raw text');
    input.value = '$"done with {y}"';
    input.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith({
      id: 'W#Execute/0',
      argIndex: 0,
      newText: '$"done with {y}"'
    });
  });

  it('renders a hint when the card has no args', () => {
    const c = card();
    c.args = [];
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit: () => {} }));
    // still shows the title; no input rows
    expect(root.textContent).toContain('Log');
    expect(root.querySelector('input')).toBeNull();
  });

  it('shows the read-only empty hint when a no-arg card is not editing', () => {
    // The empty-hint branch fires ONLY in read-only mode (in edit mode the panel
    // keeps the add-argument control instead). The no-args test above runs with
    // editing:true and no longer covers this path, so pin it explicitly.
    const c = card();
    c.args = [];
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: false, onEdit: () => {}, onArgEdit: () => {} }));
    expect(root.querySelector('.cw-props-empty')?.textContent).toBe('No editable arguments.');
    expect(root.querySelector('input')).toBeNull();
  });

  it('emits an editArg remove when a row × is clicked', () => {
    const onArgEdit = vi.fn();
    const c = card(); // Log card with one Message arg
    c.args[0].argSpan = { start: 0, end: 4 };
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {}, onArgEdit }));
    const remove = root.querySelector('.cw-arg-remove') as HTMLButtonElement;
    remove.click();
    expect(onArgEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', op: 'remove', argIndex: 0 });
  });

  it('does not show remove buttons in read-only mode', () => {
    const c = card();
    c.args[0].argSpan = { start: 0, end: 4 };
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: false, onEdit: () => {}, onArgEdit: () => {} }));
    expect(root.querySelector('.cw-arg-remove')).toBeNull();
  });

  it('passes the correct argIndex for the second arg', () => {
    const c = card();
    c.args = [
      {
        label: 'A',
        value: 'x',
        kind: 'identifier',
        editableKind: 'identifier',
        valueRaw: 'x',
        valueSpan: { start: 1, end: 2 }
      },
      {
        label: 'B',
        value: 'y',
        kind: 'identifier',
        editableKind: 'identifier',
        valueRaw: 'y',
        valueSpan: { start: 4, end: 5 }
      }
    ];
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit, onArgEdit: () => {} }));
    const inputs = root.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
    const second = inputs[1] as HTMLInputElement;
    second.value = 'z';
    second.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', argIndex: 1, newText: 'z' });
  });
});

describe('renderPseudoPanel', () => {
  function pseudo(overrides: Partial<CwPseudoStep> = {}): CwPseudoStep {
    return {
      id: 'W#Execute/0',
      type: 'pseudo',
      tier: 2,
      ruleId: 'assign-generic',
      title: 'Assign',
      text: 'x = a + b',
      icon: 'arrow-right',
      span: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      ...overrides
    };
  }

  it('shows the pseudo-step title', () => {
    const root = document.createElement('div');
    root.appendChild(renderPseudoPanel(pseudo()));
    expect(root.querySelector('.cw-props-title')?.textContent).toBe('Assign');
  });

  it('shows the FULL detail text in a .cw-props-detail block', () => {
    const longText = 'result = someVeryLongComputation(alpha, beta, gamma, delta, epsilon)';
    const root = document.createElement('div');
    root.appendChild(renderPseudoPanel(pseudo({ text: longText })));
    const detail = root.querySelector('.cw-props-detail') as HTMLElement;
    expect(detail).not.toBeNull();
    // The dock shows the full value — no ellipsis/clipping at the model layer.
    expect(detail.textContent).toBe(longText);
  });

  it('is a read-only inspector — no input fields', () => {
    const root = document.createElement('div');
    root.appendChild(renderPseudoPanel(pseudo()));
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
  });
});
