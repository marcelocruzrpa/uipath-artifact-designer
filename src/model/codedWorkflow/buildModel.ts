/**
 * Model builder for the Coded Workflow canvas — turns a parsed C# tree into a
 * classified `CodedWorkflowModel`.
 *
 * BODY WALK (T1.4)
 *   Control-flow statements become `CwContainer` nodes with child slots that
 *   are classified recursively:
 *     - `if_statement` → 'if' with a `then` slot, zero+ `elseif` slots
 *       (else-if chains are FLATTENED into sibling slots), and a final `else`
 *       slot when present.
 *     - `for`/`foreach`/`while`/`do`/`using` → a single `body` slot.
 *     - `try_statement` → a `try` slot, one `catch` slot per clause, and an
 *       optional `finally` slot.
 *     - `switch_statement` → one `case` slot per grammar `switch_section`
 *       (stacked labels are separate sections — the first is honestly empty),
 *       the label-less section becoming role 'default'.
 *   Headers and slot labels are EXACT source slices capped at
 *   `HEADER_MAX_CHARS` + '…'.  Block-less bodies (`if (x) Foo();`) become a
 *   slot whose span is the single statement's span; block bodies use the
 *   block's span.
 *
 *   `local_function_statement` is deliberately classified as ONE raw chip
 *   without recursing — helpers get no canvas, and a statement-level local
 *   function is a helper in spirit.  Bare `block` statements (`{ ... }`) are
 *   spliced into their parent slot.  Every other statement-level node —
 *   including `ERROR` nodes carrying broken source — is a LEAF and currently
 *   emits one tier-3 `CwRawChip` (tier-1/tier-2 dispatch lands in stages B/C).
 *
 * IDS
 *   Hierarchical and stable: `<methodName>/<path>` where the path joins child
 *   indices and slot roles with '.', e.g. `Execute/3.then.0`,
 *   `Execute/3.elseif1.2`, `Execute/2.case0.1`.  Repeatable roles (`elseif`,
 *   `catch`, `case`) carry a 0-based occurrence index; singleton roles
 *   (`then`, `else`, `try`, `finally`, `body`, `default`) do not.
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
 * STATS RULE
 *   `tierCounts`/`stats` count LEAVES, not containers: tier-1 cards and
 *   tier-2 steps count 1 each, raw chips count their `statementCount`.
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
  CwContainer,
  CwEntryPoint,
  CwHelperMethod,
  CwRawChip,
  CwSlot,
  CwSlotRole,
  CwStatement,
  CwTierCounts,
  CwWorkflowClass,
  SourceSpan
} from './cwTypes';
import { HEADER_MAX_CHARS } from './limits';

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
 * Build the `CodedWorkflowModel` from a parsed tree.  Never throws on
 * malformed source — broken regions degrade to raw chips and `parseHealth`
 * becomes `'partial'` (R8 error tolerance).  Does NOT take ownership of
 * `tree`; the caller remains responsible for `tree.delete()`.
 */
export function buildModel(tree: Tree, source: string, input: BuildModelInput): CodedWorkflowModel {
  const classifyStart = nowMs();

  const classes: CwWorkflowClass[] = [];
  const otherClassNames: string[] = [];
  const totals: CwTierCounts = { tier1: 0, tier2: 0, tier3: 0 };

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
      const ctx: ClassifyContext = { source };
      const body = classifyMethodBody(method, ctx);
      const tierCounts = countTiers(body);
      totals.tier1 += tierCounts.tier1;
      totals.tier2 += tierCounts.tier2;
      totals.tier3 += tierCounts.tier3;
      assignIds(body, `${name}/`);
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
      totalStatements: totals.tier1 + totals.tier2 + totals.tier3,
      tier1: totals.tier1,
      tier2: totals.tier2,
      tier3: totals.tier3,
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
 * enclosing namespace only — outer class names are not appended.
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
// Body classification — containers + leaves
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

interface ClassifyContext {
  source: string;
}

/** Exact source slice of a node. */
function slice(node: Node, ctx: ClassifyContext): string {
  return ctx.source.slice(node.startIndex, node.endIndex);
}

/** Cap an exact-source header/label at HEADER_MAX_CHARS + '…'. */
function capHeader(text: string): string {
  return text.length > HEADER_MAX_CHARS ? `${text.slice(0, HEADER_MAX_CHARS)}…` : text;
}

/** Walk a method (or local function) body: block or `=> expr` clause. */
function classifyMethodBody(method: Node, ctx: ClassifyContext): CwStatement[] {
  const body = method.childForFieldName('body');
  if (body === null) return [];
  if (body.type === 'block') {
    return classifyStatements(blockStatements(body), ctx);
  }
  if (body.type === 'arrow_expression_clause') {
    // Expression-bodied member: counted as one leaf.
    return [makeChip(body, ctx)];
  }
  return [];
}

/** Named, non-comment children of a block. */
function blockStatements(block: Node): Node[] {
  return block.namedChildren.filter((c) => c.type !== 'comment');
}

/**
 * Classify a statement list into model nodes.  Bare `block` statements are
 * spliced into the parent list.
 */
function classifyStatements(stmts: Node[], ctx: ClassifyContext): CwStatement[] {
  const out: CwStatement[] = [];
  for (const stmt of stmts) {
    if (stmt.type === 'comment') continue;
    if (stmt.type === 'block') {
      out.push(...classifyStatements(blockStatements(stmt), ctx));
      continue;
    }
    out.push(classifyStatement(stmt, ctx));
  }
  return out;
}

/** Classify one (non-block, non-comment) statement node. */
function classifyStatement(stmt: Node, ctx: ClassifyContext): CwStatement {
  switch (stmt.type) {
    case 'if_statement':
      return buildIf(stmt, ctx);
    case 'foreach_statement': {
      const left = stmt.childForFieldName('left');
      const right = stmt.childForFieldName('right');
      const header = `For Each ${left !== null ? slice(left, ctx) : '?'} in ${right !== null ? slice(right, ctx) : '?'}`;
      return buildLoop(stmt, 'foreach', header, ctx);
    }
    case 'for_statement':
      return buildLoop(stmt, 'for', `For ${parenContent(stmt, ctx)}`, ctx);
    case 'while_statement': {
      const cond = stmt.childForFieldName('condition');
      return buildLoop(stmt, 'while', `While ${cond !== null ? slice(cond, ctx) : '?'}`, ctx);
    }
    case 'do_statement': {
      const cond = stmt.childForFieldName('condition');
      return buildLoop(stmt, 'do', `Do … While ${cond !== null ? slice(cond, ctx) : '?'}`, ctx);
    }
    case 'try_statement':
      return buildTry(stmt, ctx);
    case 'switch_statement':
      return buildSwitch(stmt, ctx);
    case 'using_statement':
      return buildUsing(stmt, ctx);
    case 'local_function_statement':
      // ONE chip, no recursion — helpers get no canvas (see module header).
      return makeChip(stmt, ctx);
    default:
      // Leaves — including `ERROR` nodes, which carry the exact broken source.
      return makeChip(stmt, ctx);
  }
}

/**
 * Build a slot from a body statement: block bodies contribute their children
 * and span; a block-less body (`if (x) Foo();`) contributes one classified
 * child with the statement's own span.  A missing body yields an empty slot
 * spanning the fallback node.
 */
function slotFrom(
  role: CwSlotRole,
  label: string,
  body: Node | null,
  fallbackSpanNode: Node,
  ctx: ClassifyContext
): CwSlot {
  if (body === null) {
    return { role, label: capHeader(label), children: [], span: toSpan(fallbackSpanNode) };
  }
  const children =
    body.type === 'block'
      ? classifyStatements(blockStatements(body), ctx)
      : classifyStatements([body], ctx);
  return { role, label: capHeader(label), children, span: toSpan(body) };
}

function makeContainer(
  stmt: Node,
  kind: CwContainer['kind'],
  header: string,
  slots: CwSlot[]
): CwContainer {
  return {
    id: '',
    span: toSpan(stmt),
    type: 'container',
    kind,
    header: capHeader(header),
    slots,
    collapsedByDefault: false
  };
}

/** `if` / `else if` / `else` — chains flattened into sibling slots. */
function buildIf(stmt: Node, ctx: ClassifyContext): CwContainer {
  const condition = stmt.childForFieldName('condition');
  const slots: CwSlot[] = [
    slotFrom('then', 'Then', stmt.childForFieldName('consequence'), stmt, ctx)
  ];

  let alternative = stmt.childForFieldName('alternative');
  while (alternative !== null && alternative.type === 'if_statement') {
    const cond = alternative.childForFieldName('condition');
    slots.push(
      slotFrom(
        'elseif',
        `Else If ${cond !== null ? slice(cond, ctx) : '?'}`,
        alternative.childForFieldName('consequence'),
        alternative,
        ctx
      )
    );
    alternative = alternative.childForFieldName('alternative');
  }
  if (alternative !== null) {
    slots.push(slotFrom('else', 'Else', alternative, stmt, ctx));
  }

  return makeContainer(
    stmt,
    'if',
    `If ${condition !== null ? slice(condition, ctx) : '?'}`,
    slots
  );
}

/** for/foreach/while/do/using share the single-`body`-slot shape. */
function buildLoop(
  stmt: Node,
  kind: 'for' | 'foreach' | 'while' | 'do',
  header: string,
  ctx: ClassifyContext
): CwContainer {
  return makeContainer(stmt, kind, header, [
    slotFrom('body', 'Body', stmt.childForFieldName('body'), stmt, ctx)
  ]);
}

/**
 * Exact source between a statement's first '(' and its matching ')' — used
 * for `for (<init>; <cond>; <update>)` headers, which have no single field.
 */
function parenContent(stmt: Node, ctx: ClassifyContext): string {
  let open: Node | null = null;
  let close: Node | null = null;
  for (let i = 0; i < stmt.childCount; i += 1) {
    const child = stmt.child(i);
    if (child === null) continue;
    if (child.type === '(' && open === null) open = child;
    if (child.type === ')') close = child;
  }
  if (open === null || close === null) return '?';
  return ctx.source.slice(open.endIndex, close.startIndex).trim();
}

function buildTry(stmt: Node, ctx: ClassifyContext): CwContainer {
  const slots: CwSlot[] = [
    slotFrom('try', 'Try', stmt.childForFieldName('body'), stmt, ctx)
  ];
  for (const clause of stmt.namedChildren) {
    if (clause.type === 'catch_clause') {
      slots.push(
        slotFrom('catch', catchLabel(clause), clause.childForFieldName('body'), clause, ctx)
      );
    } else if (clause.type === 'finally_clause') {
      const block = clause.namedChildren.find((c) => c.type === 'block') ?? null;
      slots.push(slotFrom('finally', 'Finally', block, clause, ctx));
    }
  }
  return makeContainer(stmt, 'try', 'Try / Catch', slots);
}

/** `Catch` / `Catch IOException` / `Catch IOException ex` from the declaration. */
function catchLabel(clause: Node): string {
  const decl = clause.namedChildren.find((c) => c.type === 'catch_declaration');
  if (decl === undefined) return 'Catch';
  const type = decl.childForFieldName('type');
  const name = decl.childForFieldName('name');
  let label = 'Catch';
  if (type !== null) label += ` ${type.text}`;
  if (name !== null) label += ` ${name.text}`;
  return label;
}

function buildSwitch(stmt: Node, ctx: ClassifyContext): CwContainer {
  const value = stmt.childForFieldName('value');
  const slots: CwSlot[] = [];
  const body = stmt.childForFieldName('body');
  for (const section of body?.namedChildren ?? []) {
    if (section.type !== 'switch_section') continue;
    const stmts: Node[] = [];
    const labelParts: string[] = [];
    let whenClause: Node | null = null;
    for (const child of section.namedChildren) {
      if (child.type === 'comment') continue;
      if (STATEMENT_TYPES.has(child.type) || child.type === 'ERROR') {
        stmts.push(child);
      } else if (child.type === 'when_clause') {
        whenClause = child;
      } else {
        labelParts.push(slice(child, ctx));
      }
    }
    const isDefault = labelParts.length === 0;
    let label = isDefault ? 'Default' : `Case ${labelParts.join(', ')}`;
    if (whenClause !== null) label += ` ${slice(whenClause, ctx)}`;
    slots.push({
      role: isDefault ? 'default' : 'case',
      label: capHeader(label),
      children: classifyStatements(stmts, ctx),
      span: toSpan(section)
    });
  }
  return makeContainer(
    stmt,
    'switch',
    `Switch ${value !== null ? slice(value, ctx) : '?'}`,
    slots
  );
}

function buildUsing(stmt: Node, ctx: ClassifyContext): CwContainer {
  const body = stmt.childForFieldName('body');
  const resource =
    stmt.namedChildren.find(
      (c) => c.type !== 'comment' && (body === null || c.id !== body.id)
    ) ?? null;
  const header = `Use ${resource !== null ? slice(resource, ctx) : '?'}`;
  return makeContainer(stmt, 'using', header, [
    slotFrom('body', 'Body', body, stmt, ctx)
  ]);
}

/** One tier-3 raw chip for a leaf statement (id assigned later). */
function makeChip(stmt: Node, ctx: ClassifyContext): CwRawChip {
  const span = toSpan(stmt);
  return {
    id: '',
    span,
    type: 'raw',
    tier: 3,
    code: slice(stmt, ctx),
    lineCount: span.endLine - span.startLine + 1,
    statementCount: 1,
    codeTruncated: false
  };
}

// ---------------------------------------------------------------------------
// Id assignment + tier counting
// ---------------------------------------------------------------------------

/** Slot roles that may repeat within one container and get a 0-based index. */
const REPEATABLE_ROLES: ReadonlySet<CwSlotRole> = new Set(['elseif', 'catch', 'case']);

/**
 * Assign hierarchical ids (see IDS in the module header).  `prefix` already
 * ends with '/' at the top level or '.' inside a slot.
 */
function assignIds(children: CwStatement[], prefix: string): void {
  children.forEach((child, index) => {
    child.id = `${prefix}${index}`;
    if (child.type !== 'container') return;
    if (child.resourceCard !== undefined) {
      child.resourceCard.id = `${child.id}.resource`;
    }
    const roleCounts: Partial<Record<CwSlotRole, number>> = {};
    for (const slot of child.slots) {
      let segment: string = slot.role;
      if (REPEATABLE_ROLES.has(slot.role)) {
        const n = roleCounts[slot.role] ?? 0;
        roleCounts[slot.role] = n + 1;
        segment = `${slot.role}${n}`;
      }
      assignIds(slot.children, `${child.id}.${segment}.`);
    }
  });
}

/** Count leaves per tier (see STATS RULE in the module header). */
function countTiers(children: CwStatement[]): CwTierCounts {
  const counts: CwTierCounts = { tier1: 0, tier2: 0, tier3: 0 };
  addTiers(children, counts);
  return counts;
}

function addTiers(children: CwStatement[], counts: CwTierCounts): void {
  for (const child of children) {
    switch (child.type) {
      case 'activity':
        counts.tier1 += 1;
        break;
      case 'pseudo':
        counts.tier2 += 1;
        break;
      case 'raw':
        counts.tier3 += child.statementCount;
        break;
      case 'container':
        if (child.resourceCard !== undefined) counts.tier1 += 1;
        for (const slot of child.slots) addTiers(slot.children, counts);
        break;
    }
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
