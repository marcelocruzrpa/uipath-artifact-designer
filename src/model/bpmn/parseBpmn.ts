/**
 * Pure, host-side shallow scanner for Maestro BPMN (`.bpmn`) documents.
 *
 * This is intentionally a lightweight regex scan — NOT an authoritative XML
 * parse. The webview's embedded `bpmn-js` modeler owns the real parse. This
 * scan exists only to (a) gate detection — is this plausibly BPMN 2.0 XML? —
 * and (b) feed the shell a title and a few diagnostics without paying for a
 * full DOM parse on the host.
 *
 * No `vscode`, Node, or DOM dependency — pure TypeScript.
 */

import type { Diagnostic } from '../types';

/** The BPMN 2.0 model namespace every Maestro BPMN file must declare. */
const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/** The UiPath extension namespace used by Maestro BPMN files. */
const UIPATH_NS = 'http://uipath.org/schema/bpmn';

/** BPMN flow-element tag local-names counted by the shallow scan. */
const FLOW_ELEMENT_TAGS = [
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'scriptTask',
  'businessRuleTask',
  'callActivity',
  'subProcess',
  'transaction',
  'exclusiveGateway',
  'inclusiveGateway',
  'parallelGateway',
  'eventBasedGateway',
  'complexGateway',
  'sequenceFlow'
];

/** The outcome of a shallow BPMN scan. */
export interface BpmnScanResult {
  /** True when the text is plausibly well-formed BPMN 2.0 XML. */
  isBpmn: boolean;
  /** A short reason when {@link isBpmn} is false. */
  reason?: string;
  /** The `bpmn:process` `name` attribute, when found. */
  processName?: string;
  /** Count of recognized BPMN flow elements. */
  elementCount: number;
  /** True when a `bpmndi:BPMNDiagram` element is present. */
  hasDiagram: boolean;
  /** Non-blocking diagnostics surfaced in the shell's strip. */
  diagnostics: Diagnostic[];
}

/** Strips a leading UTF-8 BOM, if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Cap for the shallow regex scan. Element counting runs ~22 regex passes
 * over the input; capping at 64 KB keeps the host's CPU bounded even when
 * a pathological 2 MB BPMN reaches the parser. Real-world BPMN headers
 * (definitions, namespaces, first process) always fit in 64 KB, so
 * detection is unaffected.
 */
const FLOW_SCAN_MAX_BYTES = 64_000;

/**
 * Extracts an attribute value from the first occurrence of an opening tag
 * whose local name matches `localName` (any namespace prefix). Returns
 * `undefined` when the tag or attribute is absent.
 */
function attrOfFirstTag(xml: string, localName: string, attr: string): string | undefined {
  const tag = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>`, 'i');
  const tagMatch = tag.exec(xml);
  if (!tagMatch) {
    return undefined;
  }
  const attrPattern = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, 'i');
  const attrMatch = attrPattern.exec(tagMatch[0]);
  return attrMatch ? attrMatch[1] : undefined;
}

/** Counts opening tags whose local name matches `localName` (any prefix). */
function countTags(xml: string, localName: string): number {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b`, 'gi');
  const matches = xml.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Runs a shallow scan of a `.bpmn` document. Never throws — every failure is
 * reported through {@link BpmnScanResult.isBpmn} / `reason`.
 */
export function scanBpmn(rawText: string): BpmnScanResult {
  const empty: BpmnScanResult = {
    isBpmn: false,
    elementCount: 0,
    hasDiagram: false,
    diagnostics: []
  };

  const text = stripBom(rawText);
  if (text.trim().length === 0) {
    return { ...empty, reason: 'The file is empty.' };
  }

  // A BPMN document is a `definitions` root element (possibly namespace-prefixed).
  if (!/<(?:[\w.-]+:)?definitions\b/i.test(text)) {
    return {
      ...empty,
      reason: 'No <bpmn:definitions> root element was found — this is not BPMN 2.0 XML.'
    };
  }

  // It must declare the standard BPMN 2.0 model namespace somewhere.
  if (!text.includes(BPMN_NS)) {
    return {
      ...empty,
      reason: 'The BPMN 2.0 namespace (' + BPMN_NS + ') is not declared.'
    };
  }

  const hasProcess = /<(?:[\w.-]+:)?process\b/i.test(text);
  if (!hasProcess) {
    return {
      ...empty,
      reason: 'No <bpmn:process> element was found.'
    };
  }

  // Cap the input for the multi-pass regex count so a pathological large
  // BPMN cannot pin extension-host CPU through this scan.
  const scanText = text.length > FLOW_SCAN_MAX_BYTES ? text.slice(0, FLOW_SCAN_MAX_BYTES) : text;
  let elementCount = 0;
  for (const tag of FLOW_ELEMENT_TAGS) {
    elementCount += countTags(scanText, tag);
  }

  const hasDiagram = /<(?:[\w.-]+:)?BPMNDiagram\b/i.test(text);

  const diagnostics: Diagnostic[] = [];
  if (!hasDiagram) {
    diagnostics.push({
      severity: 'warning',
      message:
        'This .bpmn file has no <bpmndi:BPMNDiagram> — the diagram may render ' +
        'with auto-placed elements until layout is saved.'
    });
  }
  if (!text.includes(UIPATH_NS)) {
    diagnostics.push({
      severity: 'info',
      message:
        'The UiPath extension namespace (' +
        UIPATH_NS +
        ') is not declared — UiPath-specific metadata may be missing.'
    });
  }

  return {
    isBpmn: true,
    processName: attrOfFirstTag(text, 'process', 'name'),
    elementCount,
    hasDiagram,
    diagnostics
  };
}

/** Result of {@link validateBpmnXml}. */
export type BpmnValidation = { ok: true } | { ok: false; reason: string };

/**
 * Structural gate run before a `bpmnSetXml` edit is written to disk.
 *
 * This is deliberately NOT a full XML parse — the webview's `bpmn-js` modeler
 * owns the authoritative parse, and a real validator would mean a new host
 * dependency. It instead rejects the corruption modes that actually occur when
 * a webview serialization goes wrong: an empty export, output that has lost the
 * BPMN structure, and a truncated document whose root element never closes.
 */
export function validateBpmnXml(rawText: string): BpmnValidation {
  const text = stripBom(rawText);
  if (text.trim().length === 0) {
    return { ok: false, reason: 'the export was empty' };
  }
  const scan = scanBpmn(text);
  if (!scan.isBpmn) {
    return { ok: false, reason: scan.reason ?? 'the export is not recognizable BPMN 2.0 XML' };
  }
  // Truncation guard: the <definitions> root must have a matching close tag.
  if (!/<\/(?:[\w.-]+:)?definitions\s*>/i.test(text)) {
    return {
      ok: false,
      reason: 'the <bpmn:definitions> root element is not closed — the export looks truncated'
    };
  }
  return { ok: true };
}
