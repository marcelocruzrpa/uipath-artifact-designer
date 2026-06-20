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
 *   spliced into their parent slot.  Every other statement-level node is a
 *   LEAF: handle effects are tracked first (one forward-only `HandleMap` per
 *   method), then tier-1 match → `CwActivityCard`, else a tier-3 `CwRawChip`
 *   (tier-2 dispatch slots in between in Stage C).  `ERROR` nodes degrade to
 *   chips carrying the exact broken source.  A `using` resource initializer
 *   that matches tier-1 becomes the container's `resourceCard` (counted as a
 *   tier-1 leaf) and its handle still tracks.
 *
 *   DEPTH CAP (never-throws): the body walk recurses at most
 *   `MAX_NESTING_DEPTH` container levels; beyond that the remaining subtree
 *   folds into ONE raw chip (honest — the code is still shown) instead of
 *   overflowing the stack.  As a final backstop, a method body whose walk
 *   still throws `RangeError` degrades to a single raw chip of the whole body.
 *
 * IDS
 *   Hierarchical and stable: `<className>#<methodName>/<path>` where the path
 *   joins child indices and slot roles with '.', e.g.
 *   `InvoiceFlow#Execute/3.then.0`, `InvoiceFlow#Execute/3.elseif1.2`,
 *   `InvoiceFlow#Execute/2.case0.1`.  Class-qualifying the method segment
 *   keeps statement ids unique when several classes in one file declare the
 *   same method name.  Method OVERLOADS within a class disambiguate with a
 *   1-based ordinal on the method segment for the 2nd+ occurrence
 *   (`Invoices#Run/0`, `Invoices#Run@2/0`); the first occurrence stays
 *   unsuffixed so ids are stable in the common no-overload case.  Repeatable
 *   roles (`elseif`, `catch`, `case`) carry a 0-based occurrence index;
 *   singleton roles (`then`, `else`, `try`, `finally`, `body`, `default`) do
 *   not.
 *
 * WORKFLOW-CLASS RULE / BASE-TYPE RULE
 *   Live in `classDiscovery.ts` (shared with the call-graph layer).  Classes
 *   failing the workflow-class rule are listed in `otherClassNames`.
 *
 * STATS RULE
 *   `tierCounts`/`stats` count LEAVES, not containers: tier-1 cards and
 *   tier-2 steps count 1 each, raw chips count their `statementCount`.
 *
 * Class discovery (the WORKFLOW-CLASS / BASE-TYPE rules) lives in the shared
 * `classDiscovery.ts` module, also consumed by `graph/graphFacts.ts`.
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
  CwActivityCard,
  CwContainer,
  CwEntryPoint,
  CwHelperMethod,
  CwRawChip,
  CwSlot,
  CwSlotRole,
  CwStatement,
  CwTierCounts,
  CwWorkflowClass,
  OffsetSpan,
  SourceSpan
} from './cwTypes';
import {
  matchTier1,
  matchTier1Expression,
  type Tier1Match
} from './classify/tier1Match';
import {
  createHandleMap,
  trackHandle,
  type HandleMap
} from './classify/handleTracking';
import { extractArgs, extractIndexerKey } from './classify/argExtract';
import { applyTier2, TIER2_RULES, type Tier2Rule } from './classify/tier2Rules';
import { mergeAdjacentChips, chipFromSpan } from './chips';
import {
  baseTypeOf,
  classMethods,
  collectClasses,
  entryPointAttribute,
  extendsCodedWorkflow
} from './classDiscovery';
import {
  COLLAPSE_ALL_STATEMENTS,
  COLLAPSE_CONTAINER_LINES,
  COLLAPSE_STATEMENT_THRESHOLD,
  COLLAPSE_TOTAL_LINES,
  HEADER_MAX_CHARS,
  MAX_NESTING_DEPTH,
  MAX_RENDER_STATEMENTS
} from './limits';

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
  /**
   * TEST SEAM: override the tier-2 rule registry.  Production callers leave
   * this unset and get the shipped `TIER2_RULES` (the 9 shipped tier-2 rules).
   */
  tier2Rules?: readonly Tier2Rule[];
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
  // Disambiguate two workflow classes that share a simple name in ONE document
  // (legal C# across namespaces, or nested). Without this their statement ids
  // (`<class>#<method>/…`) collide and findNodeById returns the FIRST match, so
  // an edit to the second class's card would silently patch the first. Mirrors
  // the per-method overload `@N` suffix below, at the class level.
  const classOccurrences = new Map<string, number>();
  const totals: CwTierCounts = { tier1: 0, tier2: 0, tier3: 0 };
  let truncated = false;

  for (const found of collectClasses(tree.rootNode, undefined)) {
    const { classDecl, namespace } = found;
    const className = classDecl.childForFieldName('name')?.text ?? '(anonymous)';
    const methods = classMethods(classDecl);
    const entryMethods = methods.filter((m) => entryPointAttribute(m) !== null);

    if (!extendsCodedWorkflow(classDecl) && entryMethods.length === 0) {
      otherClassNames.push(className);
      continue;
    }

    // Id-safe class segment: `Worker`, then `Worker@2`, `Worker@3`, … for a
    // repeated simple name. `className` (the display name) is left unchanged.
    const classOccurrence = (classOccurrences.get(className) ?? 0) + 1;
    classOccurrences.set(className, classOccurrence);
    const classSegment = classOccurrence === 1 ? className : `${className}@${classOccurrence}`;

    const entryPoints: CwEntryPoint[] = [];
    const helperMethods: CwHelperMethod[] = [];
    const methodOccurrences = new Map<string, number>();
    for (const method of methods) {
      const name = method.childForFieldName('name')?.text ?? '(unnamed)';
      // Class-qualified id prefix; overloads get @2, @3, … on the 2nd+
      // occurrence of a method name (see IDS in the module header).
      const occurrence = (methodOccurrences.get(name) ?? 0) + 1;
      methodOccurrences.set(name, occurrence);
      const methodSegment = occurrence === 1 ? name : `${name}@${occurrence}`;
      const ctx: ClassifyContext = {
        source,
        handles: createHandleMap(),
        tier2Rules: input.tier2Rules ?? TIER2_RULES
      };
      const classified = classifyMethodBody(method, ctx);
      // tierCounts/stats keep PRE-truncation totals (see limits.ts).
      const tierCounts = countTiers(classified);
      totals.tier1 += tierCounts.tier1;
      totals.tier2 += tierCounts.tier2;
      totals.tier3 += tierCounts.tier3;
      const { body, didTruncate } = truncateStatements(classified, source);
      truncated = truncated || didTruncate;
      const bodyId = `${classSegment}#${methodSegment}/`;
      assignIds(body, bodyId);
      const interior = methodBodyInterior(method, source);
      const attribute = entryPointAttribute(method);
      if (attribute !== null) {
        entryPoints.push({
          name,
          attribute,
          span: toSpan(method),
          signatureSummary: signatureSummary(method),
          body,
          tierCounts,
          bodyId,
          ...interior
        });
      } else {
        helperMethods.push({ name, span: toSpan(method), body, tierCounts, bodyId, ...interior });
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

  const totalStatements = totals.tier1 + totals.tier2 + totals.tier3;
  const totalLines = countLines(source);
  applyCollapsePass(classes, totalStatements, totalLines);

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
    truncated,
    totalLines,
    stats: {
      totalStatements,
      tier1: totals.tier1,
      tier2: totals.tier2,
      tier3: totals.tier3,
      parseMs: input.parseMs ?? 0,
      classifyMs: nowMs() - classifyStart
    }
  };
}

// ---------------------------------------------------------------------------
// Methods, attributes, signatures
// ---------------------------------------------------------------------------

/**
 * One-line signature summary: comma-joined parameters with their modifiers
 * (`in string name, out int count`), with ` → <type>` appended for non-void
 * returns.  Generic methods prepend their `<T, U>` type-parameter list and
 * append any ` where …` constraint clauses verbatim, so a generic signature is
 * not silently shown as if it were non-generic.  A void, non-generic,
 * unconstrained method with no parameters summarizes to ''.
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

  // Generic type parameters (`<T, U>`) and `where` constraint clauses.
  const typeParams = method.childForFieldName('type_parameters');
  const prefix = typeParams !== null ? `${typeParams.text} ` : '';
  const constraints = method.namedChildren
    .filter((c) => c.type === 'type_parameter_constraints_clause')
    .map((c) => c.text.replace(/\s+/g, ' '))
    .join(' ');
  const suffix = constraints !== '' ? ` ${constraints}` : '';

  const core = returns === 'void' ? joined : joined === '' ? `→ ${returns}` : `${joined} → ${returns}`;
  return `${prefix}${core}${suffix}`;
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
  /** Method-local service-handle map, fed in source order (forward-only). */
  handles: HandleMap;
  /** Tier-2 rule registry (the shipped one, or a test override). */
  tier2Rules: readonly Tier2Rule[];
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
    // Backstop the never-throws contract: the explicit MAX_NESTING_DEPTH cap
    // bounds the classify recursion, but if any walk still overflows the stack
    // (a RangeError), degrade the whole body to one honest raw chip rather than
    // throwing.  This catches recursion outside the depth-threaded path too.
    try {
      return classifyStatements(blockStatements(body), ctx, 0);
    } catch (err) {
      if (err instanceof RangeError) return [makeChip(body, ctx)];
      throw err;
    }
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
 * spliced into the parent list.  Adjacent raw chips merge per slot as a
 * post-pass (spliced sub-lists re-merge in the parent — the re-slice from
 * source keeps that associative).
 */
function classifyStatements(stmts: Node[], ctx: ClassifyContext, depth: number): CwStatement[] {
  const out: CwStatement[] = [];
  for (const stmt of stmts) {
    if (stmt.type === 'comment') continue;
    if (stmt.type === 'block') {
      out.push(...classifyStatements(blockStatements(stmt), ctx, depth));
      continue;
    }
    out.push(classifyStatement(stmt, ctx, depth));
  }
  return mergeAdjacentChips(out, ctx.source);
}

/**
 * Classify one (non-block, non-comment) statement node.  Beyond
 * `MAX_NESTING_DEPTH` container levels the statement is folded into a single
 * raw chip WITHOUT recursing into it — bounding stack depth on pathologically
 * nested input while still showing the raw code (honest).
 */
function classifyStatement(stmt: Node, ctx: ClassifyContext, depth: number): CwStatement {
  if (depth >= MAX_NESTING_DEPTH) return makeChip(stmt, ctx);
  switch (stmt.type) {
    case 'if_statement':
      return buildIf(stmt, ctx, depth);
    case 'foreach_statement': {
      const left = stmt.childForFieldName('left');
      const right = stmt.childForFieldName('right');
      const header = `For Each ${left !== null ? slice(left, ctx) : '?'} in ${right !== null ? slice(right, ctx) : '?'}`;
      return buildLoop(stmt, 'foreach', header, ctx, depth);
    }
    case 'for_statement':
      return buildLoop(stmt, 'for', `For ${parenContent(stmt, ctx)}`, ctx, depth);
    case 'while_statement': {
      const cond = stmt.childForFieldName('condition');
      return buildLoop(stmt, 'while', `While ${cond !== null ? slice(cond, ctx) : '?'}`, ctx, depth);
    }
    case 'do_statement': {
      const cond = stmt.childForFieldName('condition');
      return buildLoop(stmt, 'do', `Do … While ${cond !== null ? slice(cond, ctx) : '?'}`, ctx, depth);
    }
    case 'try_statement':
      return buildTry(stmt, ctx, depth);
    case 'switch_statement':
      return buildSwitch(stmt, ctx, depth);
    case 'using_statement':
      return buildUsing(stmt, ctx, depth);
    case 'local_function_statement':
      // ONE chip, no recursion — helpers get no canvas (see module header).
      return makeChip(stmt, ctx);
    default:
      return classifyLeaf(stmt, ctx);
  }
}

/**
 * Leaf dispatch, strictly ordered tier1 > tier2 > chip: track handle effects
 * first (forward-only, source order), then tier-1 match → card, then tier-2
 * rule match → pseudo-step, otherwise a tier-3 raw chip.  `ERROR` nodes fall
 * through to chips carrying the exact broken source.
 */
function classifyLeaf(stmt: Node, ctx: ClassifyContext): CwStatement {
  trackHandle(ctx.handles, stmt);
  const node = leafNode(stmt, ctx);
  // Every leaf carries its whole-statement char offsets (for delete/move).
  node.offsets = offsetSpan(stmt);
  return node;
}

function leafNode(stmt: Node, ctx: ClassifyContext): CwStatement {
  const match = matchTier1(stmt, ctx.handles);
  if (match !== null) {
    return makeCard(match, toSpan(stmt), ctx);
  }
  const pseudo = applyTier2(stmt, ctx.source, ctx.tier2Rules);
  if (pseudo !== null) return pseudo;
  return makeChip(stmt, ctx);
}

/** Split PascalCase: 'ReadRange' → 'Read Range' (digits break words too). */
function humanizeMethod(method: string): string {
  return method.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Card title: catalog title → wildcard template → humanized method name. */
function cardTitle(match: Tier1Match): string {
  if (match.method === '[indexer]') return 'Get Item';
  if (match.catalogEntry !== undefined) return match.catalogEntry.title;
  if (match.wildcardTitleTemplate !== undefined) {
    return match.wildcardTitleTemplate.replace('{method}', match.method);
  }
  return humanizeMethod(match.method);
}

/** Interior char span of an invocation's argument_list (between the parens). */
function argListInterior(invocation: Node | undefined): OffsetSpan | undefined {
  if (invocation === undefined) return undefined;
  const argList = invocation.childForFieldName('arguments');
  if (argList === null) return undefined;
  // argument_list children are `( arg , arg )`; the interior is between the
  // first '(' and the last ')'.
  let open: Node | null = null;
  let close: Node | null = null;
  for (let i = 0; i < argList.childCount; i += 1) {
    const c = argList.child(i);
    if (c === null) continue;
    if (c.type === '(' && open === null) open = c;
    if (c.type === ')') close = c;
  }
  if (open === null || close === null) return undefined;
  return { start: open.endIndex, end: close.startIndex };
}

/**
 * Span of the call's METHOD-NAME token — the last segment of the callee
 * expression (the `.name` of a member/conditional/binding access, or the whole
 * identifier for a bare call; the inner identifier of a `generic_name`). This is
 * the exact range a method switch replaces, so it can never patch an earlier
 * same-named call in a chain. Undefined for an exotic callee (the switch then
 * refuses rather than guessing).
 */
function methodNameSpanOf(invocation: Node | undefined): OffsetSpan | undefined {
  if (invocation === undefined) return undefined;
  const fn = invocation.childForFieldName('function');
  if (fn === null) return undefined;
  let nameNode: Node | null;
  switch (fn.type) {
    case 'member_access_expression':
    case 'conditional_access_expression':
    case 'member_binding_expression':
      nameNode = fn.childForFieldName('name');
      break;
    case 'identifier':
    case 'generic_name':
      nameNode = fn;
      break;
    default:
      nameNode = null;
  }
  if (nameNode === null) return undefined;
  if (nameNode.type === 'generic_name') {
    const id = nameNode.namedChildren.find((c) => c.type === 'identifier');
    if (id === undefined) return undefined;
    nameNode = id;
  }
  return { start: nameNode.startIndex, end: nameNode.endIndex };
}

/** True when ANY argument of the call is passed by name (parser `name` field). */
function hasNamedArgument(invocation: Node | undefined): boolean {
  if (invocation === undefined) return false;
  const argList = invocation.childForFieldName('arguments');
  if (argList === null) return false;
  return argList.namedChildren.some(
    (c) => c.type === 'argument' && c.childForFieldName('name') !== null
  );
}

/** Build a CwActivityCard from a tier-1 match (id assigned later). */
function makeCard(match: Tier1Match, span: SourceSpan, ctx: ClassifyContext): CwActivityCard {
  const entry = match.catalogEntry;
  const args =
    match.method === '[indexer]'
      ? extractIndexerKey(match.indexerSubscript, ctx.source)
      : extractArgs(match.invocation, entry, ctx.source);
  return {
    id: '',
    span,
    type: 'activity',
    tier: 1,
    service: match.familyId,
    serviceDisplayName: match.familyDisplayName,
    method: match.method,
    ...(entry !== undefined ? { catalogId: `${match.familyId}.${match.method}` } : {}),
    title: cardTitle(match),
    args,
    ...(match.resultBinding !== undefined ? { resultBinding: match.resultBinding } : {}),
    icon: entry?.icon ?? match.familyIcon,
    ...(match.method !== '[indexer]'
      ? {
          argListSpan: argListInterior(match.invocation),
          ...(methodNameSpanOf(match.invocation) !== undefined
            ? { methodNameSpan: methodNameSpanOf(match.invocation) }
            : {}),
          ...(hasNamedArgument(match.invocation) ? { hasNamedArg: true } : {})
        }
      : {})
  };
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
  ctx: ClassifyContext,
  depth: number
): CwSlot {
  if (body === null) {
    return { role, label: capHeader(label), children: [], span: toSpan(fallbackSpanNode), braced: false };
  }
  const isBlock = body.type === 'block';
  // A slot's statements live one nesting level deeper than the container.
  const childDepth = depth + 1;
  const children = isBlock
    ? classifyStatements(blockStatements(body), ctx, childDepth)
    : classifyStatements([body], ctx, childDepth);
  return {
    role,
    label: capHeader(label),
    children,
    span: toSpan(body),
    braced: isBlock,
    ...bodyInterior(isBlock ? body : null, ctx.source)
  };
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
    offsets: offsetSpan(stmt),
    type: 'container',
    kind,
    header: capHeader(header),
    slots,
    collapsedByDefault: false
  };
}

/** `if` / `else if` / `else` — chains flattened into sibling slots. */
function buildIf(stmt: Node, ctx: ClassifyContext, depth: number): CwContainer {
  const condition = stmt.childForFieldName('condition');
  const slots: CwSlot[] = [
    slotFrom('then', 'Then', stmt.childForFieldName('consequence'), stmt, ctx, depth)
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
        ctx,
        depth
      )
    );
    alternative = alternative.childForFieldName('alternative');
  }
  if (alternative !== null) {
    slots.push(slotFrom('else', 'Else', alternative, stmt, ctx, depth));
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
  ctx: ClassifyContext,
  depth: number
): CwContainer {
  return makeContainer(stmt, kind, header, [
    slotFrom('body', 'Body', stmt.childForFieldName('body'), stmt, ctx, depth)
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

function buildTry(stmt: Node, ctx: ClassifyContext, depth: number): CwContainer {
  const slots: CwSlot[] = [
    slotFrom('try', 'Try', stmt.childForFieldName('body'), stmt, ctx, depth)
  ];
  for (const clause of stmt.namedChildren) {
    if (clause.type === 'catch_clause') {
      slots.push(
        slotFrom('catch', catchLabel(clause, ctx), clause.childForFieldName('body'), clause, ctx, depth)
      );
    } else if (clause.type === 'finally_clause') {
      const block = clause.namedChildren.find((c) => c.type === 'block') ?? null;
      slots.push(slotFrom('finally', 'Finally', block, clause, ctx, depth));
    }
  }
  return makeContainer(stmt, 'try', 'Try / Catch', slots);
}

/**
 * `Catch` / `Catch IOException` / `Catch IOException ex`, plus the exact source
 * of any `catch_filter_clause` (`when (cond)`) appended verbatim — a filtered
 * handler is CONDITIONAL, so dropping the filter would read as unconditional
 * (HONESTY).  A bare `catch when (cond)` (filter, no declaration) keeps the
 * filter too.  The filter slice mirrors `buildSwitch`'s `when_clause` handling.
 */
function catchLabel(clause: Node, ctx: ClassifyContext): string {
  const decl = clause.namedChildren.find((c) => c.type === 'catch_declaration');
  let label = 'Catch';
  if (decl !== undefined) {
    const type = decl.childForFieldName('type');
    const name = decl.childForFieldName('name');
    if (type !== null) label += ` ${type.text}`;
    if (name !== null) label += ` ${name.text}`;
  }
  const filter = clause.namedChildren.find((c) => c.type === 'catch_filter_clause');
  if (filter !== undefined) label += ` ${slice(filter, ctx)}`;
  return label;
}

function buildSwitch(stmt: Node, ctx: ClassifyContext, depth: number): CwContainer {
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
      children: classifyStatements(stmts, ctx, depth + 1),
      span: toSpan(section),
      // A switch_section's statements sit directly under it (the grammar has
      // no `{ }` wrapper unless the author writes one as a bare block, which is
      // spliced in) — so the slot is not itself braced.
      braced: false
    });
  }
  return makeContainer(
    stmt,
    'switch',
    `Switch ${value !== null ? slice(value, ctx) : '?'}`,
    slots
  );
}

function buildUsing(stmt: Node, ctx: ClassifyContext, depth: number): CwContainer {
  // Track the resource handle BEFORE classifying the body so member calls on
  // it resolve to the originating family.
  trackHandle(ctx.handles, stmt);

  const body = stmt.childForFieldName('body');
  const resource =
    stmt.namedChildren.find(
      (c) => c.type !== 'comment' && (body === null || c.id !== body.id)
    ) ?? null;
  const header = `Use ${resource !== null ? slice(resource, ctx) : '?'}`;

  const resourceCard = resource !== null ? usingResourceCard(resource, ctx) : undefined;
  const container = makeContainer(stmt, 'using', header, [
    slotFrom('body', 'Body', body, stmt, ctx, depth)
  ]);
  if (resourceCard !== undefined) container.resourceCard = resourceCard;
  return container;
}

/**
 * Tier-1 card for a `using` resource whose initializer is a service call:
 * `using (var wb = excel.UseExcelFile(...))` → a Use Excel File card bound to
 * `wb`, spanning the declarator.  Plain-expression resources
 * (`using (excel.UseExcelFile(...))`) match without a binding.
 */
function usingResourceCard(resource: Node, ctx: ClassifyContext): CwActivityCard | undefined {
  if (resource.type === 'variable_declaration') {
    const declarator = resource.namedChildren.find((c) => c.type === 'variable_declarator');
    if (declarator === undefined) return undefined;
    const name = declarator.childForFieldName('name');
    const initializer = declarator.namedChildren.find(
      (c) =>
        (name === null || c.id !== name.id) &&
        c.type !== 'bracketed_argument_list' &&
        c.type !== 'tuple_pattern' &&
        c.type !== 'comment'
    );
    if (initializer === undefined) return undefined;
    const match = matchTier1Expression(initializer, ctx.handles, name?.text);
    return match !== null ? makeCard(match, toSpan(declarator), ctx) : undefined;
  }
  const match = matchTier1Expression(resource, ctx.handles);
  return match !== null ? makeCard(match, toSpan(resource), ctx) : undefined;
}

/** One tier-3 raw chip for a leaf statement (id assigned later). */
function makeChip(stmt: Node, ctx: ClassifyContext): CwRawChip {
  const span = toSpan(stmt);
  return {
    id: '',
    span,
    offsets: offsetSpan(stmt),
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
// Scale guardrails — truncation fold + collapsedByDefault pass
// ---------------------------------------------------------------------------

/** Leaf-statement count of one statement node (containers count their leaves). */
function leafCount(stmt: CwStatement): number {
  const counts = countTiers([stmt]);
  return counts.tier1 + counts.tier2 + counts.tier3;
}

/**
 * Fold everything beyond MAX_RENDER_STATEMENTS leaves into one terminal raw
 * chip spanning the remainder (see TRUNCATION RULE in limits.ts).  The child
 * that crosses the budget is kept whole; only whole top-level children fold.
 */
function truncateStatements(
  children: CwStatement[],
  source: string
): { body: CwStatement[]; didTruncate: boolean } {
  let running = 0;
  let cut = children.length;
  for (let i = 0; i < children.length; i += 1) {
    running += leafCount(children[i]);
    if (running >= MAX_RENDER_STATEMENTS) {
      cut = i + 1;
      break;
    }
  }
  if (cut >= children.length) return { body: children, didTruncate: false };

  const kept = children.slice(0, cut);
  const folded = children.slice(cut);
  const foldedCount = folded.reduce((sum, child) => sum + leafCount(child), 0);
  kept.push(
    chipFromSpan(
      {
        startLine: folded[0].span.startLine,
        startCol: folded[0].span.startCol,
        endLine: folded[folded.length - 1].span.endLine,
        endCol: folded[folded.length - 1].span.endCol
      },
      source,
      foldedCount
    )
  );
  return { body: kept, didTruncate: true };
}

/** Set `collapsedByDefault` per the COLLAPSE RULES in limits.ts. */
function applyCollapsePass(
  classes: CwWorkflowClass[],
  totalStatements: number,
  totalLines: number
): void {
  let minCollapseDepth = Number.POSITIVE_INFINITY;
  if (totalStatements > COLLAPSE_ALL_STATEMENTS) {
    minCollapseDepth = 1;
  } else if (
    totalStatements > COLLAPSE_STATEMENT_THRESHOLD ||
    totalLines > COLLAPSE_TOTAL_LINES
  ) {
    minCollapseDepth = 2;
  }
  for (const cls of classes) {
    for (const method of [...cls.entryPoints, ...cls.helperMethods]) {
      collapseContainers(method.body, 1, minCollapseDepth);
    }
  }
}

function collapseContainers(
  children: CwStatement[],
  depth: number,
  minCollapseDepth: number
): void {
  for (const child of children) {
    if (child.type !== 'container') continue;
    const spanLines = child.span.endLine - child.span.startLine + 1;
    child.collapsedByDefault =
      depth >= minCollapseDepth || spanLines > COLLAPSE_CONTAINER_LINES;
    for (const slot of child.slots) {
      collapseContainers(slot.children, depth + 1, minCollapseDepth);
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

/** Char-offset span (for surgical edits) from tree-sitter indices. */
function offsetSpan(node: Node): OffsetSpan {
  return { start: node.startIndex, end: node.endIndex };
}

/**
 * Interior offsets of a block (`{ … }`) and the leading indent of its 1st
 * statement (for placement arithmetic).  Returns `{}` for a non-block body.
 */
function bodyInterior(
  block: Node | null,
  source: string
): { bodySpan?: OffsetSpan; indentText?: string } {
  if (block === null || block.type !== 'block') return {};
  let open: Node | null = null;
  let close: Node | null = null;
  for (let i = 0; i < block.childCount; i += 1) {
    const c = block.child(i);
    if (c === null) continue;
    if (c.type === '{' && open === null) open = c;
    if (c.type === '}') close = c;
  }
  if (open === null || close === null) return {};
  const firstStmt = block.namedChildren.find((c) => c.type !== 'comment') ?? null;
  let indentText: string;
  if (firstStmt !== null) {
    // Copy the first statement's actual leading indent verbatim.
    const lineStart = source.lastIndexOf('\n', firstStmt.startIndex - 1) + 1;
    indentText = leadingWhitespace(source, lineStart);
  } else {
    // EMPTY block: no statement to copy from. Derive the indent from the block's
    // OWN line indent (the line that opens it) + one indentation step, so a first
    // insertion nests correctly instead of landing at the method-body column.
    const openLineStart = source.lastIndexOf('\n', open.startIndex - 1) + 1;
    // LEADING whitespace of the opening line only (the `{` sits mid-line, so a
    // strip-non-whitespace pass would also collect interior spaces — match the
    // leading run instead).
    const blockIndent = leadingWhitespace(source, openLineStart);
    indentText = blockIndent + indentStep(source, blockIndent);
  }
  return { bodySpan: { start: open.endIndex, end: close.startIndex }, indentText };
}

/** The leading whitespace run of the line beginning at `lineStart`. */
function leadingWhitespace(source: string, lineStart: number): string {
  let i = lineStart;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i += 1;
  return source.slice(lineStart, i);
}

/**
 * One indentation step for the document. Tab-indented files step by a tab;
 * space-indented files step by the smallest positive indent increment seen
 * between consecutive lines (the file's unit), defaulting to two spaces.
 */
function indentStep(source: string, blockIndent: string): string {
  if (blockIndent.includes('\t')) return '\t';
  let unit = 0;
  let prev = 0;
  for (const line of source.split('\n')) {
    const m = /^[ ]*/.exec(line);
    const width = m ? m[0].length : 0;
    if (line.trim() !== '') {
      const delta = width - prev;
      if (delta > 0 && (unit === 0 || delta < unit)) unit = delta;
      prev = width;
    }
  }
  return ' '.repeat(unit > 0 ? unit : 2);
}

/** Body interior + indent for a method (or local function) node. */
function methodBodyInterior(
  method: Node,
  source: string
): { bodySpan?: OffsetSpan; indentText?: string } {
  const body = method.childForFieldName('body');
  return bodyInterior(body, source);
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
