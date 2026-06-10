/**
 * v0 model builder for the Coded Workflow canvas — the "walking skeleton"
 * stub classifier that turns a parsed C# tree into a `CodedWorkflowModel`.
 *
 * V0 BODY RULE (replaced by full tier classification in T1.4)
 *   Each method body is walked with the container/leaf rule shared with the
 *   M0 corpus spike: control-flow statements (`if` / `for` / `foreach` /
 *   `while` / `do` / `try` / `switch` / `using`-with-block / `block` /
 *   `local_function_statement`) are CONTAINERS — we recurse into their
 *   bodies/clauses without emitting the container itself.  Every other
 *   statement-level node is a LEAF and emits exactly ONE tier-3 `CwRawChip`,
 *   FLAT (no `CwContainer` nodes, no merging of adjacent leaves yet), whose
 *   `code` is the exact source slice of the statement.  Statements inside
 *   broken regions (tree-sitter `ERROR` nodes) still emit a chip carrying the
 *   exact broken source.  Chip ids are `<methodName>/<index>` in walk order,
 *   so an unchanged structure keeps identical ids across rebuilds.
 *
 * WORKFLOW-CLASS RULE (same as the corpus spike)
 *   A class is a workflow class when its base list names `CodedWorkflow` as
 *   the last segment of any base type, OR when at least one of its methods
 *   carries a `[Workflow]` / `[TestCase]` attribute (covers partial classes
 *   whose base list lives in another file).  All other classes are listed in
 *   `otherClassNames`.
 *
 * BASE-TYPE RULE
 *   `baseType` is the source text of the base whose last segment is
 *   `CodedWorkflow` when one exists; otherwise the first base type's text;
 *   otherwise (attribute-only class with no base list) the literal
 *   `'CodedWorkflow'`, since such classes inherit it via another partial.
 *
 * PURITY RULE: this module may import only types from `web-tree-sitter` and
 * the local model types.  No `vscode`, `fs`, `path`, or `node:*` imports —
 * it runs in the extension host and in plain-Node tests alike.  Timing uses
 * `globalThis.performance` with a 0 fallback instead of `Date.now` to stay
 * portable and side-effect free.
 */
import type { Node, Tree } from 'web-tree-sitter';
import type { Diagnostic } from '../types';
import type {
  CodedWorkflowModel,
  CwEntryPoint,
  CwHelperMethod,
  CwRawChip,
  CwStatement,
  CwTierCounts,
  CwWorkflowClass,
  SourceSpan
} from './cwTypes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildModelInput {
  fileName: string;
  fileUri: string;
  /**
   * Milliseconds the caller spent in `handle.parse()`, measured with the same
   * monotonic clock as `nowMs()`.  Optional because pure-test callers parse
   * inline; defaults to 0.
   */
  parseMs?: number;
}

/** Monotonic milliseconds; 0 when no `performance` global exists (pure fallback). */
export function nowMs(): number {
  return globalThis.performance?.now?.() ?? 0;
}

/**
 * Build the v0 `CodedWorkflowModel` from a parsed tree.  Never throws on
 * malformed source — broken regions degrade to raw chips and `parseHealth`
 * becomes `'partial'` (R8 error tolerance).  Does NOT take ownership of
 * `tree`; the caller remains responsible for `tree.delete()`.
 */
export function buildModel(tree: Tree, source: string, input: BuildModelInput): CodedWorkflowModel {
  const classifyStart = nowMs();

  const classes: CwWorkflowClass[] = [];
  const otherClassNames: string[] = [];
  let totalLeaves = 0;

  for (const found of collectClasses(tree.rootNode, undefined)) {
    const { classDecl, namespace } = found;
    const className = classDecl.childForFieldName('name')?.text ?? '(anonymous)';
    const methods = classMethods(classDecl);
    const entryMethods = methods.filter((m) => entryPointAttribute(m) !== null);

    if (!extendsCodedWorkflow(classDecl) && entryMethods.length === 0) {
      otherClassNames.push(className);
      continue;
    }

    const entryPoints: CwEntryPoint[] = [];
    const helperMethods: CwHelperMethod[] = [];
    for (const method of methods) {
      const name = method.childForFieldName('name')?.text ?? '(unnamed)';
      const body = collectLeafChips(method, name, source);
      totalLeaves += body.length;
      const tierCounts: CwTierCounts = { tier1: 0, tier2: 0, tier3: body.length };
      const attribute = entryPointAttribute(method);
      if (attribute !== null) {
        entryPoints.push({
          name,
          attribute,
          span: toSpan(method),
          signatureSummary: signatureSummary(method),
          body,
          tierCounts
        });
      } else {
        helperMethods.push({ name, span: toSpan(method), body, tierCounts });
      }
    }

    classes.push({
      className,
      ...(namespace !== undefined ? { namespace } : {}),
      baseType: baseTypeOf(classDecl),
      span: toSpan(classDecl),
      entryPoints,
      helperMethods
    });
  }

  const parseErrorCount = countParseErrors(tree.rootNode);
  const parseHealth = parseErrorCount > 0 ? 'partial' : 'ok';
  const diagnostics: Diagnostic[] =
    parseHealth === 'partial'
      ? [
          {
            severity: 'warning',
            message: 'Some statements could not be parsed and are shown as raw code.'
          }
        ]
      : [];

  return {
    kind: 'coded-workflow',
    title: input.fileName,
    subtitle: 'Coded Workflow',
    diagnostics,
    fileName: input.fileName,
    fileUri: input.fileUri,
    classes,
    otherClassNames,
    parseHealth,
    parseErrorCount,
    truncated: false,
    totalLines: countLines(source),
    stats: {
      totalStatements: totalLeaves,
      tier1: 0,
      tier2: 0,
      tier3: totalLeaves,
      parseMs: input.parseMs ?? 0,
      classifyMs: nowMs() - classifyStart
    }
  };
}

// ---------------------------------------------------------------------------
// Class discovery
// ---------------------------------------------------------------------------

interface FoundClass {
  classDecl: Node;
  /** Dotted enclosing namespace, or undefined at the top level. */
  namespace: string | undefined;
}

/**
 * Collect every `class_declaration` in source order, tracking the enclosing
 * (possibly nested) namespace.  Classes nested inside other classes keep the
 * enclosing namespace only — outer class names are not appended in v0.
 *
 * Note: in this grammar version a `file_scoped_namespace_declaration` spans
 * only the `namespace X;` line and the declarations follow as SIBLINGS, so it
 * sets the namespace for the rest of the current scope (we still recurse into
 * it to stay compatible with grammar versions that nest the declarations).
 */
function collectClasses(node: Node, namespace: string | undefined): FoundClass[] {
  const found: FoundClass[] = [];
  let current = namespace;
  for (const child of node.namedChildren) {
    switch (child.type) {
      case 'file_scoped_namespace_declaration': {
        const name = child.childForFieldName('name')?.text;
        if (name !== undefined) {
          current = current === undefined ? name : `${current}.${name}`;
        }
        found.push(...collectClasses(child, current));
        break;
      }
      case 'namespace_declaration': {
        const name = child.childForFieldName('name')?.text;
        const inner =
          name === undefined ? current : current === undefined ? name : `${current}.${name}`;
        found.push(...collectClasses(child, inner));
        break;
      }
      case 'class_declaration': {
        found.push({ classDecl: child, namespace: current });
        const body = child.childForFieldName('body');
        if (body !== null) found.push(...collectClasses(body, current));
        break;
      }
      case 'declaration_list':
      case 'ERROR':
        found.push(...collectClasses(child, current));
        break;
      default:
        break;
    }
  }
  return found;
}

/** Last identifier segment of a type name (`A.B.CodedWorkflow` → `CodedWorkflow`). */
function lastTypeNameSegment(node: Node): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text;
    case 'qualified_name': {
      const name = node.childForFieldName('name');
      return name !== null ? lastTypeNameSegment(name) : null;
    }
    case 'generic_name': {
      const id = node.namedChildren.find((c) => c.type === 'identifier');
      return id !== undefined ? id.text : null;
    }
    case 'primary_constructor_base_type': {
      for (const child of node.namedChildren) {
        const seg = lastTypeNameSegment(child);
        if (seg !== null) return seg;
      }
      return null;
    }
    default:
      return null;
  }
}

function baseListOf(classDecl: Node): Node | undefined {
  return classDecl.namedChildren.find((c) => c.type === 'base_list');
}

/** True when the base list names `CodedWorkflow` as its last segment. */
function extendsCodedWorkflow(classDecl: Node): boolean {
  const baseList = baseListOf(classDecl);
  if (baseList === undefined) return false;
  return baseList.namedChildren.some((base) => lastTypeNameSegment(base) === 'CodedWorkflow');
}

/** Resolve `baseType` per the BASE-TYPE RULE in the module header. */
function baseTypeOf(classDecl: Node): string {
  const baseList = baseListOf(classDecl);
  if (baseList !== undefined) {
    const matching = baseList.namedChildren.find(
      (base) => lastTypeNameSegment(base) === 'CodedWorkflow'
    );
    if (matching !== undefined) return matching.text;
    const first = baseList.namedChildren[0];
    if (first !== undefined) return first.text;
  }
  return 'CodedWorkflow';
}

// ---------------------------------------------------------------------------
// Methods, attributes, signatures
// ---------------------------------------------------------------------------

/** Direct `method_declaration` children of the class body. */
function classMethods(classDecl: Node): Node[] {
  const body = classDecl.childForFieldName('body');
  if (body === null) return [];
  return body.namedChildren.filter((c) => c.type === 'method_declaration');
}

/** `'Workflow'` / `'TestCase'` when the method is an entry point, else null. */
function entryPointAttribute(method: Node): 'Workflow' | 'TestCase' | null {
  for (const child of method.namedChildren) {
    if (child.type !== 'attribute_list') continue;
    for (const attr of child.namedChildren) {
      if (attr.type !== 'attribute') continue;
      const name = attr.childForFieldName('name');
      const seg = name !== null ? lastTypeNameSegment(name) : null;
      if (seg === 'Workflow' || seg === 'TestCase') return seg;
    }
  }
  return null;
}

/**
 * One-line signature summary: comma-joined parameters with their modifiers
 * (`in string name, out int count`), with ` → <type>` appended for non-void
 * returns.  A void method with no parameters summarizes to ''.
 */
function signatureSummary(method: Node): string {
  const params: string[] = [];
  const parameterList = method.childForFieldName('parameters');
  for (const param of parameterList?.namedChildren ?? []) {
    if (param.type !== 'parameter') continue;
    const parts: string[] = [];
    for (const child of param.namedChildren) {
      if (child.type === 'modifier') parts.push(child.text);
    }
    const type = param.childForFieldName('type');
    if (type !== null) parts.push(type.text);
    const name = param.childForFieldName('name');
    if (name !== null) parts.push(name.text);
    if (parts.length > 0) params.push(parts.join(' '));
  }
  const joined = params.join(', ');
  const returns = method.childForFieldName('returns')?.text ?? 'void';
  if (returns === 'void') return joined;
  return joined === '' ? `→ ${returns}` : `${joined} → ${returns}`;
}

// ---------------------------------------------------------------------------
// v0 body walk — flat leaf chips
// ---------------------------------------------------------------------------

/** Statement node types per the grammar's `statement` supertype. */
const STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'block',
  'break_statement',
  'checked_statement',
  'continue_statement',
  'do_statement',
  'empty_statement',
  'expression_statement',
  'fixed_statement',
  'for_statement',
  'foreach_statement',
  'goto_statement',
  'if_statement',
  'labeled_statement',
  'local_declaration_statement',
  'local_function_statement',
  'lock_statement',
  'preproc_if',
  'return_statement',
  'switch_statement',
  'throw_statement',
  'try_statement',
  'unsafe_statement',
  'using_statement',
  'while_statement',
  'yield_statement'
]);

/** Walk a method body and return one flat `CwRawChip` per leaf statement. */
function collectLeafChips(method: Node, methodName: string, source: string): CwRawChip[] {
  const chips: CwStatement[] = [];
  const ctx: WalkContext = { source, methodName, chips };
  visitMethodBody(method.childForFieldName('body'), ctx);
  return chips as CwRawChip[];
}

interface WalkContext {
  source: string;
  methodName: string;
  chips: CwStatement[];
}

function emitLeaf(stmt: Node, ctx: WalkContext): void {
  const span = toSpan(stmt);
  ctx.chips.push({
    id: `${ctx.methodName}/${ctx.chips.length}`,
    span,
    type: 'raw',
    tier: 3,
    code: ctx.source.slice(stmt.startIndex, stmt.endIndex),
    lineCount: span.endLine - span.startLine + 1,
    statementCount: 1,
    codeTruncated: false
  });
}

function visitOptional(node: Node | null, ctx: WalkContext): void {
  if (node !== null) visitStatement(node, ctx);
}

/** Visit one statement node: recurse through containers, emit leaves. */
function visitStatement(stmt: Node, ctx: WalkContext): void {
  switch (stmt.type) {
    case 'comment':
      return;
    case 'block':
      for (const child of stmt.namedChildren) visitStatement(child, ctx);
      return;
    case 'if_statement':
      visitOptional(stmt.childForFieldName('consequence'), ctx);
      visitOptional(stmt.childForFieldName('alternative'), ctx);
      return;
    case 'for_statement':
    case 'foreach_statement':
    case 'while_statement':
    case 'do_statement':
    case 'using_statement':
      visitOptional(stmt.childForFieldName('body'), ctx);
      return;
    case 'try_statement': {
      visitOptional(stmt.childForFieldName('body'), ctx);
      for (const clause of stmt.namedChildren) {
        if (clause.type === 'catch_clause') {
          visitOptional(clause.childForFieldName('body'), ctx);
        } else if (clause.type === 'finally_clause') {
          const block = clause.namedChildren.find((c) => c.type === 'block');
          if (block !== undefined) visitStatement(block, ctx);
        }
      }
      return;
    }
    case 'switch_statement': {
      const body = stmt.childForFieldName('body');
      if (body === null) return;
      for (const section of body.namedChildren) {
        if (section.type !== 'switch_section') continue;
        for (const child of section.namedChildren) {
          if (STATEMENT_TYPES.has(child.type) || child.type === 'ERROR') {
            visitStatement(child, ctx);
          }
        }
      }
      return;
    }
    case 'local_function_statement':
      visitMethodBody(stmt.childForFieldName('body'), ctx);
      return;
    default:
      // Leaves — including `ERROR` nodes, which carry the exact broken source.
      emitLeaf(stmt, ctx);
  }
}

/** Walk a method (or local function) body: block or `=> expr` clause. */
function visitMethodBody(body: Node | null, ctx: WalkContext): void {
  if (body === null) return;
  if (body.type === 'block') {
    visitStatement(body, ctx);
  } else if (body.type === 'arrow_expression_clause') {
    // Expression-bodied member: counted as one leaf (see header).
    emitLeaf(body, ctx);
  }
}

// ---------------------------------------------------------------------------
// Spans, error counting, line counting
// ---------------------------------------------------------------------------

/** 0-based span from tree-sitter `startPosition`/`endPosition`. */
function toSpan(node: Node): SourceSpan {
  return {
    startLine: node.startPosition.row,
    startCol: node.startPosition.column,
    endLine: node.endPosition.row,
    endCol: node.endPosition.column
  };
}

/**
 * Count `ERROR` and missing nodes in the whole tree.  `node.hasError` is true
 * whenever the subtree contains an error or missing node, so clean subtrees
 * are pruned — the walk is O(errors), not O(nodes), on healthy files.
 * Anonymous children are included because missing tokens (e.g. a dropped `;`)
 * are anonymous.
 */
function countParseErrors(node: Node): number {
  if (!node.hasError && !node.isMissing) return 0;
  let count = node.type === 'ERROR' || node.isMissing ? 1 : 0;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null) count += countParseErrors(child);
  }
  return count;
}

function countLines(source: string): number {
  let lines = 1;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}
