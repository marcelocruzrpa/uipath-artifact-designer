/**
 * Call-graph FACT EXTRACTION for the coded-workflow project map (T2.1, R6) —
 * the per-file first stage.  Takes a pre-parsed tree and distills the three
 * invocation mechanisms the graph cares about, plus the class declarations
 * needed to resolve them in `assembleGraph`.
 *
 * EXTRACTION PATTERNS
 *   (a) `workflows.Foo(args)` / `this.workflows.Foo(args)`
 *         → kind 'workflows-member', calleeName 'Foo'.
 *   (b) bare or member `RunWorkflow(...)` / `RunWorkflowAsync(...)`
 *         → kind 'run-workflow'.  When the first argument is a string
 *         literal (plain or verbatim — escape sequences decoded), calleeName
 *         is the literal value and `isLiteralArg` is true; otherwise
 *         calleeName is `DYNAMIC_WORKFLOW_NAME` and `isLiteralArg` false.
 *   (c) helper calls ONLY for trivially-static receivers —
 *       `new ClassName(...).Method(...)` and `ClassName.Static(...)` where
 *       ClassName is a PascalCase identifier → kind 'helper-call' with
 *       calleeName ClassName.  Resolution against declared project classes
 *       happens in `assembleGraph`.
 *
 * RECORDED PRODUCT INTERPRETATION (R6 never-drop scope)
 *   Unmatched calls to arbitrary local methods are NOT edged.  R6's
 *   never-drop rule applies to the workflow-invocation mechanisms
 *   (`workflows.*`, `RunWorkflow*`), where dropping would lie about
 *   orchestration; edging every other C# call would bury that signal in
 *   noise.  Hence only the patterns above produce facts at all.
 *
 * Class discovery reuses the shared `classDiscovery.ts` rules (the same ones
 * `buildModel.ts` uses) — `workflowMethods` lists ALL public method names of
 * each class.  (The assembler resolves `workflows.Foo` against CLASS NAMES
 * only — the `workflows` proxy has one member per workflow class, not per
 * method — so this list is reported for diagnostics/future use, not member
 * resolution.)
 *
 * PURITY RULE: imports only types from `web-tree-sitter` and the shared
 * class-discovery module.  No `vscode`, `fs`, `path`, or `node:*` imports —
 * runs in the extension host and in plain-Node tests alike.
 */
import type { Node, Tree } from 'web-tree-sitter';
import {
  classMethods,
  collectClasses,
  entryPointAttribute,
  isWorkflowClass
} from '../classDiscovery';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkflowDecl {
  className: string;
  /** WORKFLOW-CLASS RULE: `CodedWorkflow` base OR an entry-attribute method. */
  isCodedWorkflow: boolean;
  /**
   * ALL public method names, in source order.  Reported for diagnostics; the
   * assembler resolves `workflows.Foo` against CLASS names only, never these.
   */
  workflowMethods: string[];
  /** Any method carries `[Workflow]` / `[TestCase]`. */
  hasWorkflowAttribute: boolean;
}

export interface InvocationFact {
  kind: 'workflows-member' | 'run-workflow' | 'helper-call';
  calleeName: string;
  /**
   * For 'run-workflow': whether the first argument was a string literal.
   * Vacuously true for the other kinds (their target is statically named).
   */
  isLiteralArg: boolean;
  /** 0-based start line of the invocation (UI adds 1 for display). */
  line: number;
  /** Nearest enclosing class name; '' for top-level statements. */
  ownerClassName: string;
}

export interface FileFacts {
  relPath: string;
  parseHadErrors: boolean;
  decls: WorkflowDecl[];
  invocations: InvocationFact[];
}

/** Placeholder callee for RunWorkflow calls whose target is not a literal. */
export const DYNAMIC_WORKFLOW_NAME = '<dynamic workflow>';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the call-graph facts of one parsed file.  Never throws on broken
 * source — the walk visits `ERROR` subtrees too, so facts that survived the
 * parse are still reported alongside `parseHadErrors: true`.
 * Does NOT take ownership of `tree`; the caller still calls `tree.delete()`.
 *
 * `_source` is part of the contract for future exact-slice extraction;
 * today every needed slice comes from tree-node `.text`.
 */
export function extractFileFacts(relPath: string, _source: string, tree: Tree): FileFacts {
  const decls = collectClasses(tree.rootNode, undefined).map((found) =>
    declFacts(found.classDecl)
  );
  const invocations: InvocationFact[] = [];
  collectInvocations(tree.rootNode, '', invocations);
  return {
    relPath,
    parseHadErrors: tree.rootNode.hasError,
    decls,
    invocations
  };
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

function declFacts(classDecl: Node): WorkflowDecl {
  const className = classDecl.childForFieldName('name')?.text ?? '(anonymous)';
  const methods = classMethods(classDecl);
  return {
    className,
    isCodedWorkflow: isWorkflowClass(classDecl),
    workflowMethods: methods
      .filter(isPublicMethod)
      .map((m) => m.childForFieldName('name')?.text ?? '(unnamed)'),
    hasWorkflowAttribute: methods.some((m) => entryPointAttribute(m) !== null)
  };
}

function isPublicMethod(method: Node): boolean {
  return method.namedChildren.some((c) => c.type === 'modifier' && c.text === 'public');
}

// ---------------------------------------------------------------------------
// Invocation walk
// ---------------------------------------------------------------------------

/** Identifier that could plausibly name a project class (PascalCase). */
const PASCAL_IDENTIFIER = /^[A-Z][A-Za-z0-9_]*$/;

const RUN_WORKFLOW_NAMES: ReadonlySet<string> = new Set(['RunWorkflow', 'RunWorkflowAsync']);

/**
 * Depth-first walk over ALL named nodes (ERROR subtrees included — R8 error
 * tolerance), tracking the nearest enclosing class name.  Nested invocations
 * (`workflows.Outer(workflows.Inner())`) each produce their own fact because
 * the walk continues into invocation children.
 */
function collectInvocations(node: Node, ownerClassName: string, out: InvocationFact[]): void {
  for (const child of node.namedChildren) {
    let owner = ownerClassName;
    if (child.type === 'class_declaration') {
      owner = child.childForFieldName('name')?.text ?? ownerClassName;
    } else if (child.type === 'invocation_expression') {
      const fact = classifyInvocation(child, ownerClassName);
      if (fact !== null) out.push(fact);
    }
    collectInvocations(child, owner, out);
  }
}

/** Method-name text, stripping type arguments off `generic_name` nodes. */
function methodNameText(nameNode: Node): string {
  if (nameNode.type === 'generic_name') {
    const id = nameNode.namedChildren.find((c) => c.type === 'identifier');
    return id !== undefined ? id.text : nameNode.text;
  }
  return nameNode.text;
}

/** Classify one invocation against patterns (a)/(b)/(c); null = not a fact. */
function classifyInvocation(inv: Node, ownerClassName: string): InvocationFact | null {
  const fn = inv.childForFieldName('function');
  if (fn === null) return null;
  const line = inv.startPosition.row;

  // Bare calls: only RunWorkflow / RunWorkflowAsync are interesting.
  if (fn.type === 'identifier' || fn.type === 'generic_name') {
    return RUN_WORKFLOW_NAMES.has(methodNameText(fn))
      ? runWorkflowFact(inv, ownerClassName, line)
      : null;
  }

  if (fn.type !== 'member_access_expression') return null;
  const nameNode = fn.childForFieldName('name');
  const receiver = fn.childForFieldName('expression');
  if (nameNode === null || receiver === null) return null;
  const method = methodNameText(nameNode);

  // (a) workflows.Foo(...) / this.workflows.Foo(...)
  if (isWorkflowsReceiver(receiver)) {
    return { kind: 'workflows-member', calleeName: method, isLiteralArg: true, line, ownerClassName };
  }

  // (b) member-form RunWorkflow / RunWorkflowAsync on any receiver.
  if (RUN_WORKFLOW_NAMES.has(method)) {
    return runWorkflowFact(inv, ownerClassName, line);
  }

  // (c) trivially-static helper receivers only.
  if (receiver.type === 'identifier' && PASCAL_IDENTIFIER.test(receiver.text)) {
    return { kind: 'helper-call', calleeName: receiver.text, isLiteralArg: true, line, ownerClassName };
  }
  if (receiver.type === 'object_creation_expression') {
    const type = receiver.childForFieldName('type');
    if (type !== null && type.type === 'identifier' && PASCAL_IDENTIFIER.test(type.text)) {
      return { kind: 'helper-call', calleeName: type.text, isLiteralArg: true, line, ownerClassName };
    }
  }
  return null;
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

function runWorkflowFact(inv: Node, ownerClassName: string, line: number): InvocationFact {
  const literal = firstArgumentStringLiteral(inv);
  return {
    kind: 'run-workflow',
    calleeName: literal ?? DYNAMIC_WORKFLOW_NAME,
    isLiteralArg: literal !== null,
    line,
    ownerClassName
  };
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
