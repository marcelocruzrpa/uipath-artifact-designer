/**
 * Tests for the host-side BPMN scanner / validator (`parseBpmn.ts`).
 *
 * `validateBpmnXml` is the structural gate (H2) run before a `bpmnSetXml` edit
 * is written to disk — it must reject the corruption modes a bad webview
 * serialization produces (empty export, non-BPMN text, truncated document).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanBpmn, validateBpmnXml } from '../../src/model/bpmn/parseBpmn';

const FIXTURES = join(__dirname, '..', 'fixtures');
const wellFormedBpmn = readFileSync(join(FIXTURES, 'sample.bpmn'), 'utf8');

describe('validateBpmnXml — accepts well-formed BPMN', () => {
  it('accepts a well-formed BPMN 2.0 document', () => {
    expect(validateBpmnXml(wellFormedBpmn)).toEqual({ ok: true });
  });

  it('accepts a document with a namespace-prefixed close tag', () => {
    expect(validateBpmnXml(wellFormedBpmn).ok).toBe(true);
  });
});

describe('validateBpmnXml — rejects malformed input', () => {
  it('rejects an empty string', () => {
    const result = validateBpmnXml('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/empty/i);
    }
  });

  it('rejects a whitespace-only string', () => {
    expect(validateBpmnXml('   \n\t  ').ok).toBe(false);
  });

  it('rejects plain non-BPMN text', () => {
    const result = validateBpmnXml('this is not xml at all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not BPMN|definitions/i);
    }
  });

  it('rejects XML that is not BPMN (missing BPMN namespace)', () => {
    const result = validateBpmnXml('<definitions><process/></definitions>');
    expect(result.ok).toBe(false);
  });

  it('rejects a truncated document missing the </definitions> close tag', () => {
    // Drop the closing root tag — the classic truncation corruption mode.
    const truncated = wellFormedBpmn.replace(/<\/bpmn:definitions>\s*$/, '');
    expect(truncated).not.toContain('</bpmn:definitions>');
    const result = validateBpmnXml(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/truncat|not closed/i);
    }
  });
});

describe('scanBpmn', () => {
  it('counts flow elements and detects the diagram in a well-formed file', () => {
    const scan = scanBpmn(wellFormedBpmn);
    expect(scan.isBpmn).toBe(true);
    expect(scan.processName).toBe('Sample Process');
    expect(scan.elementCount).toBeGreaterThan(0);
    expect(scan.hasDiagram).toBe(true);
  });

  it('reports an empty file as not BPMN', () => {
    const scan = scanBpmn('');
    expect(scan.isBpmn).toBe(false);
    expect(scan.reason).toBeDefined();
  });
});
