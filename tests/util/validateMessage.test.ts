/**
 * Tests for the runtime webview-message decoder (`validateWebviewMessage`).
 *
 * This boundary is security-critical: it is the only runtime check on
 * webview->host messages, which feed JSON edit paths and arbitrary content
 * straight to disk. The prototype-pollution rejection (H1) is the headline
 * regression test here.
 */
import { describe, expect, it } from 'vitest';
import { validateWebviewMessage } from '../../src/util/validateMessage';

describe('validateWebviewMessage — valid messages', () => {
  it('accepts a bare lifecycle message', () => {
    expect(validateWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(validateWebviewMessage({ type: 'openParentAgent' })).toEqual({
      type: 'openParentAgent'
    });
    expect(validateWebviewMessage({ type: 'reopenAsText' })).toEqual({ type: 'reopenAsText' });
  });

  it('accepts an editAgentField with a safe path', () => {
    const msg = { type: 'editAgentField', path: ['settings', 'model'], value: 'gpt-4o' };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts an editAgentPrompt', () => {
    const msg = { type: 'editAgentPrompt', role: 'system', content: 'Be helpful.' };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts an editArguments message', () => {
    const msg = {
      type: 'editArguments',
      direction: 'input',
      properties: [{ name: 'in1', type: 'string', description: 'desc' }],
      required: ['in1']
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts a setActionSchemaSection message', () => {
    const msg = {
      type: 'setActionSchemaSection',
      section: 'inputs',
      fields: [{ name: 'f1', field: { type: 'string' } }]
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts flow editing messages', () => {
    expect(
      validateWebviewMessage({ type: 'flowMoveNode', nodeId: 'n1', x: 10, y: 20 })
    ).toEqual({ type: 'flowMoveNode', nodeId: 'n1', x: 10, y: 20 });
    expect(
      validateWebviewMessage({
        type: 'flowAddEdge',
        id: 'e1',
        sourceNodeId: 'a',
        sourcePort: 'output',
        targetNodeId: 'b',
        targetPort: 'input'
      })
    ).not.toBeNull();
  });

  it('accepts a bpmnSetXml message', () => {
    const msg = { type: 'bpmnSetXml', xml: '<bpmn:definitions/>' };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts case editing messages', () => {
    expect(
      validateWebviewMessage({
        type: 'caseAddStage',
        stageKind: 'stage',
        label: 'New',
        description: '',
        isRequired: true
      })
    ).not.toBeNull();
    expect(
      validateWebviewMessage({
        type: 'caseSetConditions',
        scope: 'case-exit',
        conditions: []
      })
    ).toEqual({ type: 'caseSetConditions', scope: 'case-exit', stageId: undefined, conditions: [] });
  });

  it('accepts a persistViewState message', () => {
    const msg = {
      type: 'persistViewState',
      state: { zoom: 1, panX: 0, panY: 0, selectedId: null }
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts a persistViewState with string[] collapsedIds', () => {
    const msg = {
      type: 'persistViewState',
      state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: ['c1', 'c2'] }
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it('accepts a persistViewState with an empty collapsedIds array', () => {
    const msg = {
      type: 'persistViewState',
      state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: [] }
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });

  it.each(['canvas', 'graph'])('accepts a persistViewState with mode %s', (mode) => {
    const msg = {
      type: 'persistViewState',
      state: { zoom: 1, panX: 0, panY: 0, selectedId: null, mode }
    };
    expect(validateWebviewMessage(msg)).toEqual(msg);
  });
});

describe('validateWebviewMessage — malformed shapes return null', () => {
  it('rejects non-objects', () => {
    expect(validateWebviewMessage(null)).toBeNull();
    expect(validateWebviewMessage(undefined)).toBeNull();
    expect(validateWebviewMessage('ready')).toBeNull();
    expect(validateWebviewMessage(42)).toBeNull();
    expect(validateWebviewMessage([])).toBeNull();
  });

  it('rejects an unknown message type', () => {
    expect(validateWebviewMessage({ type: 'notARealType' })).toBeNull();
  });

  it('rejects a message with a missing type', () => {
    expect(validateWebviewMessage({ path: ['a'], value: 1 })).toBeNull();
  });

  it('rejects editAgentField with a missing/empty path', () => {
    expect(validateWebviewMessage({ type: 'editAgentField', value: 1 })).toBeNull();
    expect(validateWebviewMessage({ type: 'editAgentField', path: [], value: 1 })).toBeNull();
  });

  it('rejects editAgentPrompt with an invalid role', () => {
    expect(
      validateWebviewMessage({ type: 'editAgentPrompt', role: 'assistant', content: 'x' })
    ).toBeNull();
  });

  it('rejects flowMoveNode with a missing coordinate', () => {
    expect(validateWebviewMessage({ type: 'flowMoveNode', nodeId: 'n1', x: 10 })).toBeNull();
  });

  it('rejects a persistViewState whose collapsedIds has non-string entries', () => {
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: ['ok', 42] }
      })
    ).toBeNull();
  });

  it('rejects a persistViewState whose collapsedIds is not an array', () => {
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: 'c1' }
      })
    ).toBeNull();
  });

  it('rejects a persistViewState whose mode is not canvas/graph', () => {
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, mode: 'sideways' }
      })
    ).toBeNull();
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, mode: 42 }
      })
    ).toBeNull();
  });
});

describe('validateWebviewMessage — prototype-pollution rejection (H1 regression)', () => {
  it('rejects an editAgentField path containing __proto__', () => {
    const msg = { type: 'editAgentField', path: ['__proto__', 'polluted'], value: 'x' };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('rejects an editAgentField path containing prototype', () => {
    const msg = { type: 'editAgentField', path: ['constructor', 'prototype', 'x'], value: 'x' };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('rejects an editAgentField path containing constructor', () => {
    const msg = { type: 'editAgentField', path: ['settings', 'constructor'], value: 'x' };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('rejects an editResourceField path containing a dangerous key', () => {
    const msg = {
      type: 'editResourceField',
      uri: 'file:///x',
      path: ['__proto__'],
      value: 1
    };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('rejects a flowSetNodeInput whose key is __proto__', () => {
    const msg = { type: 'flowSetNodeInput', nodeId: 'n1', key: '__proto__', value: 'x' };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('rejects an editArguments property whose name is __proto__', () => {
    const msg = {
      type: 'editArguments',
      direction: 'input',
      properties: [{ name: '__proto__', type: 'string', description: '' }],
      required: []
    };
    expect(validateWebviewMessage(msg)).toBeNull();
  });

  it('does not pollute Object.prototype when a dangerous message is rejected', () => {
    validateWebviewMessage({ type: 'editAgentField', path: ['__proto__', 'x'], value: 'pwned' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('validateWebviewMessage — editValue message', () => {
  it('accepts a well-formed editValue message', () => {
    expect(
      validateWebviewMessage({ type: 'editValue', id: 'W#Execute/0', argIndex: 0, newText: '"x"' })
    ).toEqual({ type: 'editValue', id: 'W#Execute/0', argIndex: 0, newText: '"x"' });
  });

  it('rejects an editValue missing argIndex', () => {
    expect(
      validateWebviewMessage({ type: 'editValue', id: 'W#Execute/0', newText: '"x"' })
    ).toBeNull();
  });

  it('rejects an editValue with a non-integer argIndex', () => {
    expect(
      validateWebviewMessage({ type: 'editValue', id: 'W#Execute/0', argIndex: 1.5, newText: '"x"' })
    ).toBeNull();
  });

  it('rejects an editValue with a missing id', () => {
    expect(
      validateWebviewMessage({ type: 'editValue', argIndex: 0, newText: '"x"' })
    ).toBeNull();
  });

  it('rejects an editValue with a missing newText', () => {
    expect(
      validateWebviewMessage({ type: 'editValue', id: 'W#Execute/0', argIndex: 0 })
    ).toBeNull();
  });
});

describe('validateWebviewMessage — editArg message', () => {
  it('accepts a well-formed editArg change', () => {
    expect(
      validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'change', argIndex: 1, newText: 'x' })
    ).not.toBeNull();
  });
  it('accepts an editArg method switch', () => {
    expect(
      validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: 'GetCredential' })
    ).not.toBeNull();
  });
  it('rejects an editArg with an unknown op', () => {
    expect(validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'nuke' })).toBeNull();
  });
  it('rejects an editArg whose newMethod is prototype-polluting', () => {
    expect(
      validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: '__proto__' })
    ).toBeNull();
  });
  it('rejects an editArg whose newMethod is not a bare identifier (code injection)', () => {
    // The validator — not just the parse-gate — must reject a non-identifier name.
    expect(
      validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: 'X(); Evil(' })
    ).toBeNull();
    expect(
      validateWebviewMessage({ type: 'editArg', id: 'W#Execute/0', op: 'method', newMethod: '1Bad' })
    ).toBeNull();
  });
});

describe('validateWebviewMessage — over-cap and non-finite rejection', () => {
  it('rejects an over-cap free-text string', () => {
    const huge = 'a'.repeat(100_001);
    expect(
      validateWebviewMessage({ type: 'editAgentPrompt', role: 'system', content: huge })
    ).toBeNull();
  });

  it('rejects an over-cap identifier string', () => {
    const hugeId = 'a'.repeat(4_097);
    expect(
      validateWebviewMessage({ type: 'flowMoveNode', nodeId: hugeId, x: 0, y: 0 })
    ).toBeNull();
  });

  it('rejects an over-cap array', () => {
    const fields = Array.from({ length: 10_001 }, (_v, i) => ({
      name: `f${i}`,
      field: {}
    }));
    expect(
      validateWebviewMessage({ type: 'setActionSchemaSection', section: 'inputs', fields })
    ).toBeNull();
  });

  it('rejects an over-cap collapsedIds array', () => {
    const collapsedIds = Array.from({ length: 10_001 }, (_v, i) => `c${i}`);
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds }
      })
    ).toBeNull();
  });

  it('rejects a collapsedIds entry over the identifier cap', () => {
    expect(
      validateWebviewMessage({
        type: 'persistViewState',
        state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: ['a'.repeat(4_097)] }
      })
    ).toBeNull();
  });

  it('rejects an over-deep edit path', () => {
    const path = Array.from({ length: 65 }, (_v, i) => `k${i}`);
    expect(validateWebviewMessage({ type: 'editAgentField', path, value: 1 })).toBeNull();
  });

  it('rejects a non-finite number value', () => {
    expect(
      validateWebviewMessage({ type: 'editAgentField', path: ['a'], value: Infinity })
    ).toBeNull();
    expect(
      validateWebviewMessage({ type: 'editAgentField', path: ['a'], value: NaN })
    ).toBeNull();
  });

  it('rejects non-finite flow node coordinates', () => {
    expect(
      validateWebviewMessage({ type: 'flowMoveNode', nodeId: 'n1', x: Infinity, y: 0 })
    ).toBeNull();
    expect(
      validateWebviewMessage({ type: 'flowMoveNode', nodeId: 'n1', x: 0, y: NaN })
    ).toBeNull();
  });

  it('rejects an over-cap BPMN XML document', () => {
    const xml = 'a'.repeat(10_000_001);
    expect(validateWebviewMessage({ type: 'bpmnSetXml', xml })).toBeNull();
  });

  it('accepts a finite-number edit value', () => {
    expect(
      validateWebviewMessage({ type: 'editAgentField', path: ['a'], value: 0.5 })
    ).toEqual({ type: 'editAgentField', path: ['a'], value: 0.5 });
  });
});
