// @vitest-environment jsdom
/**
 * Stage-L0 tests: the coded-workflow properties panel — a docked inspector
 * that, in edit mode, edits the RAW source token of an activity card's args
 * and emits an editValue intent on change. In read-only mode every field is
 * disabled (pure inspector); `editableKind: 'none'` args and args without a
 * backing token (`valueRaw === undefined`) are always disabled.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderPropertiesPanel } from '../../webview/renderers/codedWorkflow/propertiesPanel';
import type { CwActivityCard } from '../../src/model/codedWorkflow/cwTypes';

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
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit: () => {} }));
    expect(root.textContent).toContain('Log');
  });

  it('binds a string input to the unquoted CONTENT, not the raw token', () => {
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit: () => {} }));
    const input = root.querySelector('input') as HTMLInputElement;
    // editableKind 'string' shows the content ('hi'), NOT the raw token ('"hi"');
    // the host owns the quotes so the user edits the message text only.
    expect(input.value).toBe('hi');
    expect(input.value).not.toBe('"hi"');
  });

  it('edits a string field and emits its CONTENT as newText on change', () => {
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: true, onEdit }));
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('hi');
    // The user types the message text with no quotes; the host re-quotes it.
    input.value = 'bye';
    input.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', argIndex: 0, newText: 'bye' });
  });

  it('disables fields in read-only mode', () => {
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: false, onEdit: () => {} }));
    expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('does not emit when a disabled (read-only) field receives a change event', () => {
    const onEdit = vi.fn();
    const root = document.createElement('div');
    root.appendChild(renderPropertiesPanel(card(), { editing: false, onEdit }));
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
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {} }));
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
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {} }));
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
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit }));
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
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit: () => {} }));
    // still shows the title; no input rows
    expect(root.textContent).toContain('Log');
    expect(root.querySelector('input')).toBeNull();
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
    root.appendChild(renderPropertiesPanel(c, { editing: true, onEdit }));
    const inputs = root.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
    const second = inputs[1] as HTMLInputElement;
    second.value = 'z';
    second.dispatchEvent(new Event('change'));
    expect(onEdit).toHaveBeenCalledWith({ id: 'W#Execute/0', argIndex: 1, newText: 'z' });
  });
});
