/**
 * Shared detection of the two WORKFLOW-INVOCATION mechanisms the product
 * surfaces — `workflows.Foo(...)` and `RunWorkflow("X.xaml")` — over a single
 * `invocation_expression` node. Both the call-graph fact extractor
 * (`graph/graphFacts.ts`) and the file-canvas model builder
 * (`buildModel.ts`) call this, so the canvas Invoke card and the graph edge can
 * never disagree about what counts as an invocation.
 *
 * Helper calls (`new Helper().M()` / `Helper.Static()`) are deliberately NOT
 * detected here — they are ordinary method calls, not workflow invocations; the
 * graph layer classifies those itself.
 *
 * PURITY RULE: imports only types from `web-tree-sitter`. No `vscode`, `fs`,
 * `path`, or `node:*` imports — runs in the extension host and in plain-Node
 * tests alike.
 */
import type { Node } from 'web-tree-sitter';

/** The two workflow-invocation mechanisms. */
export type WorkflowInvokeKind = 'workflows-member' | 'run-workflow';

export interface DetectedInvoke {
  kind: WorkflowInvokeKind;
  /**
   * 'workflows-member': the called CLASS name (`workflows.Foo` → `Foo`).
   * 'run-workflow': the literal path argument, or {@link DYNAMIC_WORKFLOW_NAME}
   * when the first argument is not a string literal.
   */
  calleeName: string;
  /**
   * For 'run-workflow': whether the first argument was a string literal.
   * Vacuously true for 'workflows-member' (its target is statically named).
   */
  isLiteralArg: boolean;
}

/** Placeholder callee for RunWorkflow calls whose target is not a literal. */
export const DYNAMIC_WORKFLOW_NAME = '<dynamic workflow>';

const RUN_WORKFLOW_NAMES: ReadonlySet<string> = new Set(['RunWorkflow', 'RunWorkflowAsync']);

/**
 * Classify one `invocation_expression` as a workflow invocation, or null when
 * it is neither `workflows.*` nor `RunWorkflow*`. Mirrors patterns (a) and (b)
 * of `graphFacts`' extraction exactly.
 */
export function detectWorkflowInvoke(inv: Node): DetectedInvoke | null {
  const fn = inv.childForFieldName('function');
  if (fn === null) return null;

  // Bare calls: only RunWorkflow / RunWorkflowAsync are interesting.
  if (fn.type === 'identifier' || fn.type === 'generic_name') {
    return RUN_WORKFLOW_NAMES.has(methodNameText(fn)) ? runWorkflowInvoke(inv) : null;
  }

  if (fn.type !== 'member_access_expression') return null;
  const nameNode = fn.childForFieldName('name');
  const receiver = fn.childForFieldName('expression');
  if (nameNode === null || receiver === null) return null;
  const method = methodNameText(nameNode);

  // (a) workflows.Foo(...) / this.workflows.Foo(...)
  if (isWorkflowsReceiver(receiver)) {
    return { kind: 'workflows-member', calleeName: method, isLiteralArg: true };
  }

  // (b) member-form RunWorkflow / RunWorkflowAsync on any receiver.
  if (RUN_WORKFLOW_NAMES.has(method)) {
    return runWorkflowInvoke(inv);
  }

  return null;
}

/** Method-name text, stripping type arguments off `generic_name` nodes. */
export function methodNameText(nameNode: Node): string {
  if (nameNode.type === 'generic_name') {
    const id = nameNode.namedChildren.find((c) => c.type === 'identifier');
    return id !== undefined ? id.text : nameNode.text;
  }
  return nameNode.text;
}

function runWorkflowInvoke(inv: Node): DetectedInvoke {
  const literal = firstArgumentStringLiteral(inv);
  return {
    kind: 'run-workflow',
    calleeName: literal ?? DYNAMIC_WORKFLOW_NAME,
    isLiteralArg: literal !== null
  };
}

function isWorkflowsReceiver(receiver: Node): boolean {
  if (receiver.type === 'identifier') return receiver.text === 'workflows';
  if (receiver.type === 'member_access_expression') {
    const inner = receiver.childForFieldName('expression');
    const name = receiver.childForFieldName('name');
    return inner !== null && inner.type === 'this' && name !== null && name.text === 'workflows';
  }
  return false;
}

// ---------------------------------------------------------------------------
// String-literal extraction
// ---------------------------------------------------------------------------

/** Decoded value of the first argument when it is a string literal, else null. */
function firstArgumentStringLiteral(inv: Node): string | null {
  const args = inv.childForFieldName('arguments');
  const first = args?.namedChildren.find((c) => c.type === 'argument');
  if (first === undefined) return null;
  const nameField = first.childForFieldName('name');
  const expr = first.namedChildren.find(
    (c) => c.type !== 'comment' && (nameField === null || c.id !== nameField.id)
  );
  return expr !== undefined ? stringLiteralValue(expr) : null;
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '\\\\': '\\',
  '\\"': '"',
  "\\'": "'",
  '\\n': '\n',
  '\\r': '\r',
  '\\t': '\t',
  '\\0': '\0'
};

function decodeEscape(seq: string): string {
  const simple = SIMPLE_ESCAPES[seq];
  if (simple !== undefined) return simple;
  if (seq.startsWith('\\u') || seq.startsWith('\\U') || seq.startsWith('\\x')) {
    const code = Number.parseInt(seq.slice(2), 16);
    if (!Number.isNaN(code)) return String.fromCodePoint(code);
  }
  return seq.slice(1);
}

/**
 * Decode a `string_literal` (escape sequences resolved) or a
 * `verbatim_string_literal` (`@"..."`, `""` → `"`).  Interpolated strings and
 * everything else return null — they are dynamic.
 */
function stringLiteralValue(node: Node): string | null {
  if (node.type === 'string_literal') {
    let value = '';
    for (const child of node.namedChildren) {
      if (child.type === 'string_literal_content') value += child.text;
      else if (child.type === 'escape_sequence') value += decodeEscape(child.text);
    }
    return value;
  }
  if (node.type === 'verbatim_string_literal') {
    const text = node.text;
    if (!text.startsWith('@"') || !text.endsWith('"')) return null;
    return text.slice(2, -1).replace(/""/g, '"');
  }
  return null;
}
