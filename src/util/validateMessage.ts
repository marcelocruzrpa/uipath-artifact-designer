/**
 * Runtime validation for messages arriving from the webview.
 *
 * `WebviewToHost` in `messages.ts` is a COMPILE-TIME contract only — the host
 * receives whatever the webview's `postMessage` sends. A bug in webview code,
 * or a code path driven by a crafted artifact, could deliver a message whose
 * runtime shape does not match its declared type. The host then writes JSON
 * paths, condition arrays and BPMN XML straight to disk, so unvalidated input
 * is a data-integrity and prototype-pollution risk.
 *
 * `validateWebviewMessage` decodes an `unknown` value into a `WebviewToHost`,
 * returning `null` for anything that does not match exactly. It enforces:
 *  - string length caps,
 *  - finite-number checks,
 *  - enum checks for every discriminated field,
 *  - a denylist of `__proto__` / `prototype` / `constructor` for any string
 *    used as an object key (edit paths, argument / field names, input keys).
 *
 * No `vscode`, Node or DOM dependency — pure TypeScript.
 */
import type { ActionFieldEntry, ActionSchemaSectionName } from '../model/types';
import type { ArgProperty, EditValue, WebviewToHost, WebviewViewState } from './messages';
import { isRecord } from './objects';

/**
 * Keys that must never be written as an object key.
 *
 * The first three close the classic prototype-pollution sinks. The
 * `__defineGetter__` / `__defineSetter__` / `__lookupGetter__` /
 * `__lookupSetter__` quartet covers Object.prototype methods that can
 * register accessor traps if an attacker controls the key. `then` is
 * called out because writing `obj.then = …` makes the object thenable
 * (an `await obj` will resolve through whatever value the attacker chose),
 * a subtle remote-execution-adjacent footgun specific to JS.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'then'
]);

/** Generous cap for free-text fields (labels, descriptions, prompt content). */
const MAX_TEXT = 100_000;
/** Cap for identifiers, object keys and URIs. */
const MAX_ID = 4_096;
/**
 * Cap for a BPMN XML document. Real-world BPMN files are typically <500 KB;
 * 2 MB leaves ~4× headroom while keeping the host's shallow regex scan and
 * the webview's `bpmn-js` parse from doing pathological amounts of work on
 * a crafted artifact.
 */
const MAX_XML = 2_000_000;
/** Cap for the number of entries in any collection-valued message. */
const MAX_ARRAY = 10_000;
/** Cap for the depth of a JSON edit path. */
const MAX_PATH_DEPTH = 64;
/**
 * Caps for an opaquely round-tripped condition / SLA tree (see
 * {@link isPlainObjectArray}). Real DNF condition sets and SLA rules nest only
 * a handful of levels and hold tens of nodes; these bounds leave generous
 * headroom while keeping a crafted artifact from forcing a pathological
 * recursive walk — or smuggling an unbounded string — to disk.
 */
const MAX_NESTED_DEPTH = 16;
const MAX_NESTED_NODES = 50_000;

function isString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A string safe to use as an object key — never a prototype-polluting key. */
function isSafeKey(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_ID && !DANGEROUS_KEYS.has(v);
}

/** A bare C# identifier — the only shape a switched method name may take. */
const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

/** A JSON edit path: a non-empty array of safe object keys. */
function isSafePath(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= MAX_PATH_DEPTH &&
    v.every((seg) => isSafeKey(seg))
  );
}

/** A primitive an edit may write into a JSON field. */
function isEditValue(v: unknown): v is EditValue {
  return v === null || typeof v === 'boolean' || isFiniteNumber(v) || isString(v, MAX_TEXT);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_ARRAY && v.every((s) => isString(s, MAX_TEXT));
}

function isArgProperty(v: unknown): v is ArgProperty {
  return (
    isRecord(v) &&
    isSafeKey(v.name) &&
    isString(v.type, MAX_ID) &&
    isString(v.description, MAX_TEXT)
  );
}

function isArgPropertyArray(v: unknown): v is ArgProperty[] {
  return Array.isArray(v) && v.length <= MAX_ARRAY && v.every((p) => isArgProperty(p));
}

function isActionFieldEntry(v: unknown): v is ActionFieldEntry {
  return isRecord(v) && isSafeKey(v.name) && isRecord(v.field);
}

function isActionFieldEntryArray(v: unknown): v is ActionFieldEntry[] {
  return Array.isArray(v) && v.length <= MAX_ARRAY && v.every((f) => isActionFieldEntry(f));
}

function isActionSchemaSectionName(v: unknown): v is ActionSchemaSectionName {
  return v === 'inputs' || v === 'outputs' || v === 'inOuts' || v === 'outcomes';
}

/**
 * Recursively validates one node of an opaquely round-tripped value tree:
 *  - every object key is a {@link isSafeKey} (no `__proto__` / `constructor`
 *    / over-long key at ANY depth, not just the top level),
 *  - every string is within {@link MAX_TEXT} (no unbounded nested string),
 *  - nesting never exceeds {@link MAX_NESTED_DEPTH}, and
 *  - the whole tree holds at most {@link MAX_NESTED_NODES} nodes.
 *
 * `counter.n` is shared across the walk so the node budget is global, not
 * per-branch. Returns false the moment any bound is violated.
 */
function isSafeNestedValue(v: unknown, depth: number, counter: { n: number }): boolean {
  if (++counter.n > MAX_NESTED_NODES) {
    return false;
  }
  if (v === null || typeof v === 'boolean' || v === undefined) {
    return true;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v);
  }
  if (typeof v === 'string') {
    return v.length <= MAX_TEXT;
  }
  if (depth >= MAX_NESTED_DEPTH) {
    return false;
  }
  if (Array.isArray(v)) {
    return v.length <= MAX_ARRAY && v.every((item) => isSafeNestedValue(item, depth + 1, counter));
  }
  if (isRecord(v)) {
    for (const key of Object.keys(v)) {
      // A dangerous or over-long key anywhere in the tree reaches disk verbatim
      // when the value is round-tripped; reject it here (not just at the top).
      if (!isSafeKey(key) || !isSafeNestedValue(v[key], depth + 1, counter)) {
        return false;
      }
    }
    return true;
  }
  // Functions, symbols, bigint — never present in a postMessage-decoded value.
  return false;
}

/**
 * A bounded array whose entries are all plain objects. Used for condition /
 * SLA arrays that are round-tripped opaquely into `caseplan.json`. The parser
 * drops malformed entries silently, so this gate's job is to keep primitives,
 * nulls and bare nested arrays out of the top level AND — recursively — to
 * reject prototype-polluting keys and unbounded strings buried anywhere in a
 * nested object, plus cap nesting depth and total node count.
 */
function isPlainObjectArray(v: unknown): v is Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length > MAX_ARRAY) {
    return false;
  }
  const counter = { n: 0 };
  return v.every((entry) => isRecord(entry) && isSafeNestedValue(entry, 0, counter));
}

/** An optional id array: absent, or a bounded array of bounded strings. */
function isOptionalIdArray(v: unknown): v is string[] | undefined {
  return (
    v === undefined ||
    (Array.isArray(v) && v.length <= MAX_ARRAY && v.every((s) => isString(s, MAX_ID)))
  );
}

/**
 * A webview-side slot reference (mirrors `SlotRef` / `SlotRefMessage`).
 *
 * `methodId`/`containerId` are not written as object keys downstream, but we
 * still validate them through `isSafeKey` so this validator stays the single
 * gate (defense in depth — a `__proto__` ref is rejected here, not silently
 * no-matched in `findSlot`). An empty `containerId` denotes the method body
 * and is always allowed.
 */
function isSlotRef(
  v: unknown
): v is { containerId: string; methodId: string; role?: string; roleIndex?: number } {
  return (
    isRecord(v) &&
    // '' (method body) is allowed; any non-empty container id must be a safe key.
    (v.containerId === '' || isSafeKey(v.containerId)) &&
    isSafeKey(v.methodId) &&
    // role is matched against a fixed slot-role set on the host; bound it.
    (v.role === undefined || isString(v.role, MAX_ID)) &&
    (v.roleIndex === undefined || (typeof v.roleIndex === 'number' && Number.isInteger(v.roleIndex)))
  );
}

function isViewState(v: unknown): v is WebviewViewState {
  return (
    isRecord(v) &&
    isFiniteNumber(v.zoom) &&
    isFiniteNumber(v.panX) &&
    isFiniteNumber(v.panY) &&
    (v.selectedId === null || isString(v.selectedId, MAX_ID)) &&
    isOptionalIdArray(v.collapsedIds) &&
    (v.mode === undefined || v.mode === 'canvas' || v.mode === 'graph') &&
    (v.editing === undefined || typeof v.editing === 'boolean')
  );
}

/**
 * Decodes an untrusted value into a `WebviewToHost`. Returns `null` when the
 * value does not match its declared message type exactly.
 */
export function validateWebviewMessage(raw: unknown): WebviewToHost | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    // --- navigation / lifecycle ---
    case 'ready':
      return { type: 'ready' };
    case 'openParentAgent':
      return { type: 'openParentAgent' };
    case 'reopenAsText':
      return { type: 'reopenAsText' };
    case 'openResource':
      return isString(raw.uri, MAX_ID) &&
        (raw.preview === undefined || typeof raw.preview === 'boolean')
        ? {
            type: 'openResource',
            uri: raw.uri,
            ...(raw.preview !== undefined ? { preview: raw.preview } : {})
          }
        : null;
    case 'persistViewState':
      return isViewState(raw.state) ? { type: 'persistViewState', state: raw.state } : null;
    case 'log':
      return (raw.level === 'info' || raw.level === 'warn' || raw.level === 'error') &&
        isString(raw.message, MAX_TEXT)
        ? { type: 'log', level: raw.level, message: raw.message }
        : null;

    // --- agent editing ---
    case 'editAgentField':
      return isSafePath(raw.path) && isEditValue(raw.value)
        ? { type: 'editAgentField', path: raw.path, value: raw.value }
        : null;
    case 'editAgentPrompt':
      return (raw.role === 'system' || raw.role === 'user') && isString(raw.content, MAX_TEXT)
        ? { type: 'editAgentPrompt', role: raw.role, content: raw.content }
        : null;
    case 'editProject':
      return (raw.field === 'Name' || raw.field === 'Description') && isString(raw.value, MAX_TEXT)
        ? { type: 'editProject', field: raw.field, value: raw.value }
        : null;
    case 'editResourceField':
      return isString(raw.uri, MAX_ID) && isSafePath(raw.path) && isEditValue(raw.value)
        ? { type: 'editResourceField', uri: raw.uri, path: raw.path, value: raw.value }
        : null;
    case 'editArguments':
      return (raw.direction === 'input' || raw.direction === 'output') &&
        isArgPropertyArray(raw.properties) &&
        isStringArray(raw.required)
        ? {
            type: 'editArguments',
            direction: raw.direction,
            properties: raw.properties,
            required: raw.required
          }
        : null;

    // --- coded app ---
    case 'setActionSchemaSection':
      return isActionSchemaSectionName(raw.section) && isActionFieldEntryArray(raw.fields)
        ? { type: 'setActionSchemaSection', section: raw.section, fields: raw.fields }
        : null;

    // --- maestro flow ---
    case 'flowSetNodeLabel':
      return isString(raw.nodeId, MAX_ID) && isString(raw.label, MAX_TEXT)
        ? { type: 'flowSetNodeLabel', nodeId: raw.nodeId, label: raw.label }
        : null;
    case 'flowSetNodeInput':
      return isString(raw.nodeId, MAX_ID) && isSafeKey(raw.key) && isString(raw.value, MAX_TEXT)
        ? { type: 'flowSetNodeInput', nodeId: raw.nodeId, key: raw.key, value: raw.value }
        : null;
    case 'flowMoveNode':
      return isString(raw.nodeId, MAX_ID) && isFiniteNumber(raw.x) && isFiniteNumber(raw.y)
        ? { type: 'flowMoveNode', nodeId: raw.nodeId, x: raw.x, y: raw.y }
        : null;
    case 'flowAddEdge':
      return isString(raw.id, MAX_ID) &&
        isString(raw.sourceNodeId, MAX_ID) &&
        isString(raw.sourcePort, MAX_ID) &&
        isString(raw.targetNodeId, MAX_ID) &&
        isString(raw.targetPort, MAX_ID)
        ? {
            type: 'flowAddEdge',
            id: raw.id,
            sourceNodeId: raw.sourceNodeId,
            sourcePort: raw.sourcePort,
            targetNodeId: raw.targetNodeId,
            targetPort: raw.targetPort
          }
        : null;
    case 'flowRemoveEdge':
      return isString(raw.edgeId, MAX_ID) ? { type: 'flowRemoveEdge', edgeId: raw.edgeId } : null;
    case 'flowRemoveNode':
      return isString(raw.nodeId, MAX_ID) ? { type: 'flowRemoveNode', nodeId: raw.nodeId } : null;

    // --- maestro bpmn ---
    case 'bpmnSetXml':
      return isString(raw.xml, MAX_XML) ? { type: 'bpmnSetXml', xml: raw.xml } : null;

    // --- maestro case ---
    case 'caseAddStage':
      return (raw.stageKind === 'stage' || raw.stageKind === 'exception-stage') &&
        isString(raw.label, MAX_TEXT) &&
        isString(raw.description, MAX_TEXT) &&
        typeof raw.isRequired === 'boolean'
        ? {
            type: 'caseAddStage',
            stageKind: raw.stageKind,
            label: raw.label,
            description: raw.description,
            isRequired: raw.isRequired
          }
        : null;
    case 'caseDeleteStage':
      return isString(raw.stageId, MAX_ID)
        ? { type: 'caseDeleteStage', stageId: raw.stageId }
        : null;
    case 'caseSetStageField':
      return isString(raw.stageId, MAX_ID) &&
        (raw.field === 'label' || raw.field === 'description' || raw.field === 'isRequired') &&
        (isString(raw.value, MAX_TEXT) || typeof raw.value === 'boolean')
        ? { type: 'caseSetStageField', stageId: raw.stageId, field: raw.field, value: raw.value }
        : null;
    case 'caseSetTriggerLabel':
      return isString(raw.triggerId, MAX_ID) && isString(raw.label, MAX_TEXT)
        ? { type: 'caseSetTriggerLabel', triggerId: raw.triggerId, label: raw.label }
        : null;
    case 'caseAddEdge':
      return isString(raw.sourceId, MAX_ID) &&
        isString(raw.targetId, MAX_ID) &&
        isString(raw.label, MAX_TEXT)
        ? { type: 'caseAddEdge', sourceId: raw.sourceId, targetId: raw.targetId, label: raw.label }
        : null;
    case 'caseDeleteEdge':
      return isString(raw.edgeId, MAX_ID) ? { type: 'caseDeleteEdge', edgeId: raw.edgeId } : null;
    case 'caseSetEdgeLabel':
      return isString(raw.edgeId, MAX_ID) && isString(raw.label, MAX_TEXT)
        ? { type: 'caseSetEdgeLabel', edgeId: raw.edgeId, label: raw.label }
        : null;
    case 'caseSetConditions': {
      const stageId = raw.stageId;
      if (
        (raw.scope === 'stage-entry' ||
          raw.scope === 'stage-exit' ||
          raw.scope === 'case-exit') &&
        (stageId === undefined || isString(stageId, MAX_ID)) &&
        isPlainObjectArray(raw.conditions)
      ) {
        return { type: 'caseSetConditions', scope: raw.scope, stageId, conditions: raw.conditions };
      }
      return null;
    }
    case 'caseSetSlaRules': {
      const stageId = raw.stageId;
      if (
        (stageId === undefined || isString(stageId, MAX_ID)) &&
        isPlainObjectArray(raw.slaRules)
      ) {
        return { type: 'caseSetSlaRules', stageId, slaRules: raw.slaRules };
      }
      return null;
    }

    // --- coded workflow canvas ---
    case 'editValue':
      return isString(raw.id, MAX_ID) &&
        typeof raw.argIndex === 'number' &&
        Number.isInteger(raw.argIndex) &&
        isString(raw.newText, MAX_TEXT)
        ? { type: 'editValue', id: raw.id, argIndex: raw.argIndex, newText: raw.newText }
        : null;
    case 'editArg':
      return isString(raw.id, MAX_ID) &&
        (raw.op === 'change' || raw.op === 'add' || raw.op === 'remove' || raw.op === 'method') &&
        (raw.argIndex === undefined || (typeof raw.argIndex === 'number' && Number.isInteger(raw.argIndex))) &&
        (raw.newText === undefined || isString(raw.newText, MAX_TEXT)) &&
        // A method name is written into source as an identifier — require BOTH a
        // safe key (no prototype pollution) AND a bare-identifier shape (so a
        // payload like `X(); Evil(` is rejected here, not just at the parse-gate).
        (raw.newMethod === undefined ||
          (isSafeKey(raw.newMethod) && IDENTIFIER_RE.test(raw.newMethod)))
        ? {
            type: 'editArg',
            id: raw.id,
            op: raw.op,
            ...(raw.argIndex !== undefined ? { argIndex: raw.argIndex } : {}),
            ...(raw.newText !== undefined ? { newText: raw.newText } : {}),
            ...(raw.newMethod !== undefined ? { newMethod: raw.newMethod } : {})
          }
        : null;
    case 'addStatement':
      // The webview sends a palette item id + per-arg values, NOT final C#; the
      // host emits from the trusted template. `rawText` is bounded here but only
      // honored host-side for the `raw` escape item.
      return isSlotRef(raw.slot) &&
        typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0 &&
        isString(raw.paletteItemId, MAX_ID) &&
        isStringArray(raw.argValues) &&
        (raw.resultBinding === undefined || isString(raw.resultBinding, MAX_ID)) &&
        (raw.rawText === undefined || isString(raw.rawText, MAX_TEXT))
        ? {
            type: 'addStatement',
            slot: raw.slot,
            index: raw.index,
            paletteItemId: raw.paletteItemId,
            argValues: raw.argValues,
            ...(raw.resultBinding !== undefined ? { resultBinding: raw.resultBinding } : {}),
            ...(raw.rawText !== undefined ? { rawText: raw.rawText } : {})
          }
        : null;
    case 'deleteStatement':
      return isString(raw.id, MAX_ID) ? { type: 'deleteStatement', id: raw.id } : null;
    case 'moveStatement':
      return isString(raw.id, MAX_ID) && (raw.direction === 1 || raw.direction === -1)
        ? { type: 'moveStatement', id: raw.id, direction: raw.direction }
        : null;

    default:
      return null;
  }
}
