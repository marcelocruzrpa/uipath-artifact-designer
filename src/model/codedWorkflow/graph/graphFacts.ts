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
  /**
   * Id-disambiguation suffix for a class whose SIMPLE NAME repeats within this
   * file (nested, or two namespaces in one file). Present only on the 2nd+ such
   * declaration (`Worker@2`), so a non-colliding class is byte-for-byte
   * unchanged. The assembler keys the node id on `idKey ?? className`; `className`
   * stays the display/label and the `workflows.Foo` resolution name.
   */
  idKey?: string;
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
  /**
   * Id-disambiguation key of the enclosing class — present only when that class's
   * simple name repeats within the file (see {@link WorkflowDecl.idKey}). The
   * assembler keys the edge SOURCE on `ownerKey ?? ownerClassName` so a call in a
   * genuinely-distinct same-named class attaches to ITS node, not the first.
   */
  ownerKey?: string;
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
  const found = collectClasses(tree.rootNode, undefined);
  const classKey = makeClassKeyResolver(found.map((f) => f.classDecl));
  const decls = found.map((f) => declFacts(f.classDecl, classKey));
  const invocations: InvocationFact[] = [];
  collectInvocations(tree.rootNode, { name: '', key: '' }, invocations, classKey);
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

function classNameOf(node: Node): string {
  return node.childForFieldName('name')?.text ?? '(anonymous)';
}

/**
 * Builds a stable per-file id key for each class declaration. A simple name that
 * appears once returns unchanged; a name that repeats (nested, or two namespaces
 * in one file) gets `name@2`, `name@3`, … by source position — so two
 * same-named classes never collapse to one node id. Mirrors the class-level
 * overload suffix `buildModel.ts` uses for the edit model.
 */
function makeClassKeyResolver(classDecls: Node[]): (node: Node) => string {
  const counts = new Map<string, number>();
  for (const d of classDecls) {
    const n = classNameOf(d);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const rankByStart = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const d of [...classDecls].sort((a, b) => a.startIndex - b.startIndex)) {
    const n = classNameOf(d);
    const r = (seen.get(n) ?? 0) + 1;
    seen.set(n, r);
    rankByStart.set(d.startIndex, r);
  }
  return (node: Node) => {
    const n = classNameOf(node);
    if ((counts.get(n) ?? 0) <= 1) return n;
    const r = rankByStart.get(node.startIndex) ?? 1;
    return r === 1 ? n : `${n}@${r}`;
  };
}

function declFacts(classDecl: Node, classKey: (node: Node) => string): WorkflowDecl {
  const className = classNameOf(classDecl);
  const key = classKey(classDecl);
  const methods = classMethods(classDecl);
  return {
    className,
    ...(key !== className ? { idKey: key } : {}),
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

/** Nearest enclosing class: display name + id-disambiguation key (see idKey). */
interface Owner {
  name: string;
  key: string;
}

/** The owner fields for a fact: `ownerKey` is set only when it differs from the name. */
function ownerFields(owner: Owner): { ownerClassName: string; ownerKey?: string } {
  return owner.key !== owner.name
    ? { ownerClassName: owner.name, ownerKey: owner.key }
    : { ownerClassName: owner.name };
}

/**
 * Depth-first walk over ALL named nodes (ERROR subtrees included — R8 error
 * tolerance), tracking the nearest enclosing class.  Nested invocations
 * (`workflows.Outer(workflows.Inner())`) each produce their own fact because
 * the walk continues into invocation children.
 */
function collectInvocations(node: Node, owner: Owner, out: InvocationFact[], classKey: (n: Node) => string): void {
  for (const child of node.namedChildren) {
    let next = owner;
    if (child.type === 'class_declaration') {
      next = { name: classNameOf(child), key: classKey(child) };
    } else if (child.type === 'invocation_expression') {
      const fact = classifyInvocation(child, owner);
      if (fact !== null) out.push(fact);
    }
    collectInvocations(child, next, out, classKey);
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
function classifyInvocation(inv: Node, owner: Owner): InvocationFact | null {
  const fn = inv.childForFieldName('function');
  if (fn === null) return null;
  const line = inv.startPosition.row;

  // Bare calls: only RunWorkflow / RunWorkflowAsync are interesting.
  if (fn.type === 'identifier' || fn.type === 'generic_name') {
    return RUN_WORKFLOW_NAMES.has(methodNameText(fn))
      ? runWorkflowFact(inv, owner, line)
      : null;
  }

  if (fn.type !== 'member_access_expression') return null;
  const nameNode = fn.childForFieldName('name');
  const receiver = fn.childForFieldName('expression');
  if (nameNode === null || receiver === null) return null;
  const method = methodNameText(nameNode);

  // (a) workflows.Foo(...) / this.workflows.Foo(...)
  if (isWorkflowsReceiver(receiver)) {
    return { kind: 'workflows-member', calleeName: method, isLiteralArg: true, line, ...ownerFields(owner) };
  }

  // (b) member-form RunWorkflow / RunWorkflowAsync on any receiver.
  if (RUN_WORKFLOW_NAMES.has(method)) {
    return runWorkflowFact(inv, owner, line);
  }

  // (c) trivially-static helper receivers only.
  if (receiver.type === 'identifier' && PASCAL_IDENTIFIER.test(receiver.text)) {
    return { kind: 'helper-call', calleeName: receiver.text, isLiteralArg: true, line, ...ownerFields(owner) };
  }
  if (receiver.type === 'object_creation_expression') {
    const type = receiver.childForFieldName('type');
    if (type !== null && type.type === 'identifier' && PASCAL_IDENTIFIER.test(type.text)) {
      return { kind: 'helper-call', calleeName: type.text, isLiteralArg: true, line, ...ownerFields(owner) };
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

function runWorkflowFact(inv: Node, owner: Owner, line: number): InvocationFact {
  const literal = firstArgumentStringLiteral(inv);
  return {
    kind: 'run-workflow',
    calleeName: literal ?? DYNAMIC_WORKFLOW_NAME,
    isLiteralArg: literal !== null,
    line,
    ...ownerFields(owner)
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
