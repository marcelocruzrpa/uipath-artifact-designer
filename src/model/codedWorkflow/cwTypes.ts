/**
 * Shared intermediate representation for the Coded Workflow canvas.
 *
 * This is the JSON-serializable contract that crosses the host→webview
 * `postMessage` boundary — no functions, no Map/Set, no class instances.
 * Imported by BOTH the extension host (Node) and the webview (DOM), so it
 * must stay free of any `vscode`, Node, or DOM dependency — pure TypeScript
 * interfaces only (a type-only import from `../types` is allowed).
 */
import type { ArtifactModelBase } from '../types';
import type { CodedProjectGraph } from './graph/graphTypes';

/** 0-based lines+cols — matches tree-sitter Point and vscode.Position; UI adds 1 for display. */
export interface SourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** Char offsets (0-based, into the file) of the rendered value's exact source. */
export interface OffsetSpan {
  start: number;
  end: number;
}

export interface CwArgSummary {
  label: string;
  value: string;
  kind: 'literal' | 'interpolated' | 'identifier' | 'target' | 'expression';
  /** Exact source range of the VALUE token(s); absent when the value is synthesized. */
  valueSpan?: OffsetSpan;
  /**
   * The exact source slice of the value token — `source.slice(valueSpan.start,
   * valueSpan.end)`. Present whenever `valueSpan` is (same backing node). Unlike
   * `value` (the unquoted/clipped DISPLAY), this is the raw token the form edits.
   */
  valueRaw?: string;
  /**
   * Char offsets of the WHOLE `argument` node (name + value), so a remove can
   * delete the argument and a change can replace it. Absent for synthesized
   * rows (e.g. object-prop summaries) and indexer keys with no argument node.
   */
  argSpan?: OffsetSpan;
  /**
   * True when this row's `argument` is a C# NAMED argument (`name: value`),
   * detected from the PARSER's `name` field — robust to `@`-verbatim and unicode
   * identifiers that a text regex misses. The edit engine uses it to reject a
   * whole-span `change` (which would drop the `name:`). Absent ⇒ positional.
   */
  isNamed?: boolean;
  /**
   * How the value may be edited from a form:
   *   'string'|'number'|'bool'|'enum' → typed field; 'identifier' → text field;
   *   'raw' → raw-text only (expression/interpolated); 'none' → read-only.
   */
  editableKind: 'string' | 'number' | 'bool' | 'enum' | 'identifier' | 'raw' | 'none';
  /**
   * Present ONLY on a `+N more` overflow row: the structured, read-only detail
   * for each folded argument (label = C# param name or positional `argN`, value
   * = its source). The CARD shows the compact `+N more` summary; the PROPERTIES
   * PANEL expands these into one row each, so a many-argument call (e.g. an
   * 11-arg `system.SetTransactionStatus`) reveals every argument instead of
   * hiding them behind the count.
   */
  overflowArgs?: CwArgSummary[];
}

interface CwNodeBase {
  id: string;
  span: SourceSpan;
  /** Char offsets of the whole statement node (for delete/move ranges). */
  offsets?: OffsetSpan;
}

export interface CwActivityCard extends CwNodeBase {
  type: 'activity';
  tier: 1;
  service: string;
  serviceDisplayName: string;
  method: string;
  catalogId?: string;
  title: string;
  args: CwArgSummary[];
  resultBinding?: string;
  icon: string;
  /**
   * Char offsets of the INTERIOR of the call's `argument_list` — the range
   * between `(` and `)` exclusive (so an empty `()` has start === end). An
   * arg add splices at `argListSpan.end`.
   * Absent for indexer matches (no argument_list) and synthesized cards.
   */
  argListSpan?: OffsetSpan;
  /**
   * Char offsets of the call's METHOD-NAME token (the last callee segment) — the
   * exact range a method switch replaces. Stored from the parse tree, NOT
   * re-found by scanning source for `method(` (which patches the wrong call in a
   * chain like `a.GetAsset().GetAsset(1)`). Absent ⇒ a method switch is refused.
   */
  methodNameSpan?: OffsetSpan;
  /**
   * True when ANY argument of the call is passed by name (parser `name` field) —
   * across ALL args, not just the surfaced rows, so the engine can reject an
   * `add` that would place a positional argument after a named one (CS1738).
   */
  hasNamedArg?: boolean;
  /**
   * Set when this activity is a WORKFLOW INVOCATION (`workflows.Foo(...)` →
   * 'workflows-member', `RunWorkflow("X.xaml")` → 'run-workflow'), detected at
   * build time alongside the tier-1 match. Drives double-click "open the invoked
   * workflow". `invokeCallee` is the callee CLASS name (workflows-member) or the
   * literal/placeholder path (run-workflow). `invokeTarget` is resolved
   * host-side from the project graph (`attachInvokeTargets`); absent until then.
   */
  invokeKind?: 'workflows-member' | 'run-workflow';
  invokeCallee?: string;
  invokeTarget?: CwInvokeTarget;
}

export interface CwPseudoStep extends CwNodeBase {
  type: 'pseudo';
  tier: 2;
  ruleId: string;
  title: string;
  text: string;
  icon: string;
}

/**
 * Resolution of an invoke activity's target workflow, computed host-side from
 * the project call graph (`attachInvokeTargets`). Mirrors the graph view's
 * outcomes so a card and its graph node read the same:
 *   - 'resolved'      → exactly one target file; `uri` is set (openable).
 *   - 'no-match'      → no project workflow matches the callee.
 *   - 'ambiguous'     → several classes share the callee name (no single file).
 *   - 'dynamic'       → RunWorkflow(<non-literal>) — target not statically known.
 *   - 'missing-file'  → literal RunWorkflow path with no file on disk.
 * Absent until the host attaches it (e.g. when the project graph is unavailable).
 */
export interface CwInvokeTarget {
  status: 'resolved' | 'no-match' | 'ambiguous' | 'dynamic' | 'missing-file';
  /** File URI to open — present only when `status === 'resolved'`. */
  uri?: string;
  /** Project-relative path of the target, for the label / tooltip. */
  relPath?: string;
}

export interface CwRawChip extends CwNodeBase {
  type: 'raw';
  tier: 3;
  code: string;
  lineCount: number;
  statementCount: number;
  codeTruncated: boolean;
  /**
   * Set when this chip is a bare call to ONE of the SAME class's own helper
   * methods (`SetStatus(...)`, `this.SafeCloseAndKill(...)`) that resolves
   * UNIQUELY to a rendered `Helper:` section. Drives an in-file "jump to the
   * helper" affordance: a double-click reveals + focuses the target section.
   * Stays tier-3 (a local method call is not a UiPath service call, so tier
   * metrics stay honest) and the raw code is still shown when expanded.
   * `targetId` matches the helper section's DOM id (`<className>#helper:<name>`).
   * Helper-call chips are never merged into a multi-statement run, so the call
   * stays individually navigable.
   */
  helperTarget?: { name: string; targetId: string };
}

export type CwContainerKind = 'if' | 'foreach' | 'for' | 'while' | 'do' | 'try' | 'switch' | 'using';

export type CwSlotRole =
  | 'then'
  | 'elseif'
  | 'else'
  | 'body'
  | 'try'
  | 'catch'
  | 'finally'
  | 'case'
  | 'default';

export interface CwSlot {
  role: CwSlotRole;
  label: string;
  children: CwStatement[];
  span: SourceSpan;
  /**
   * Char offsets of the slot BODY interior — the range inside the `{ }` block
   * (or the single block-less statement). An insert at the top of an empty
   * slot targets `bodySpan.start`; an append targets `bodySpan.end`.
   */
  bodySpan?: OffsetSpan;
  /** Leading whitespace of statements in this slot (inferred indentation). */
  indentText?: string;
  /**
   * Whether the slot body is a real `{ }` block.  `true` for a block body,
   * `false` for a block-less single statement (`if (x) Foo();`) and for a
   * null/empty body.  The edit engine reads this to decide whether an insert
   * can splice into existing braces or must first wrap the body in `{ }`.
   */
  braced?: boolean;
}

/**
 * State-machine annotation attached to a `switch` container that a loop drives
 * over an enum state variable (the REFramework `while(true){ switch(state){…} }`
 * shape). PURELY ADDITIVE: the underlying `switch`/`case`/Assign model is
 * unchanged and still renders inside when expanded — this only lets the canvas
 * surface the states + transitions every RPA developer recognizes. Absent when
 * the conservative detector (`classify/stateMachine.ts`) does not match.
 */
export interface CwStateMachine {
  /** The switched-over state variable (`state`). */
  stateVar: string;
  /** One entry per `case`, in source order. */
  states: Array<{
    /** The enum member name (`Init`, `Process`, …) — the `case State.X` label. */
    label: string;
    /** Distinct target states this case transitions to (`state = State.Y`). */
    transitions: string[];
  }>;
}

export interface CwContainer extends CwNodeBase {
  type: 'container';
  kind: CwContainerKind;
  header: string;
  resourceCard?: CwActivityCard;
  slots: CwSlot[];
  collapsedByDefault: boolean;
  /** Present on a `switch` recognized as a loop-driven enum state machine (F3). */
  stateMachine?: CwStateMachine;
}

export type CwStatement = CwActivityCard | CwPseudoStep | CwRawChip | CwContainer;

export interface CwTierCounts {
  tier1: number;
  tier2: number;
  tier3: number;
}

export interface CwEntryPoint {
  name: string;
  attribute: 'Workflow' | 'TestCase';
  span: SourceSpan;
  signatureSummary: string;
  body: CwStatement[];
  tierCounts: CwTierCounts;
  /**
   * Char offsets of the method body interior (inside the `{ }`); an insert at
   * the top of an empty body targets `bodySpan.start`, an append `bodySpan.end`.
   */
  bodySpan?: OffsetSpan;
  /** Leading whitespace of the body's statements (inferred indentation). */
  indentText?: string;
  /**
   * The exact id-prefix `buildModel` assigned this body's statements
   * (`<class>#<methodSegment>/`, e.g. `W#Execute/` or, for an overload,
   * `W#Run@2/`). A SlotRef's `methodId` is matched against THIS, so insertion
   * is unambiguous even for overloaded methods and empty bodies. (Reconstructing
   * `<class>#<name>/` from `name` would mis-target the 2nd+ overload.)
   */
  bodyId?: string;
}

export interface CwHelperMethod {
  name: string;
  span: SourceSpan;
  body: CwStatement[];
  tierCounts: CwTierCounts;
  /** Char offsets of the method body interior (see CwEntryPoint.bodySpan). */
  bodySpan?: OffsetSpan;
  /** Leading whitespace of the body's statements (inferred indentation). */
  indentText?: string;
  /** The exact id-prefix assigned this body's statements (see CwEntryPoint.bodyId). */
  bodyId?: string;
}

export interface CwWorkflowClass {
  className: string;
  namespace?: string;
  baseType: string;
  span: SourceSpan;
  entryPoints: CwEntryPoint[];
  helperMethods: CwHelperMethod[];
}

/** The Coded Workflow editor model — a classified C# source file. */
export interface CodedWorkflowModel extends ArtifactModelBase {
  kind: 'coded-workflow';
  fileName: string;
  fileUri: string;
  classes: CwWorkflowClass[];
  otherClassNames: string[];
  parseHealth: 'ok' | 'partial' | 'stale';
  staleReason?: string;
  /**
   * Project call graph (T2.2). `null` when unavailable — no project root
   * found, or the build failed (a warning diagnostic explains why).
   * Absent on models built before the graph feature existed (lastGood cache).
   */
  graph?: CodedProjectGraph | null;
  parseErrorCount: number;
  truncated: boolean;
  totalLines: number;
  stats: {
    totalStatements: number;
    tier1: number;
    tier2: number;
    tier3: number;
    parseMs: number;
    classifyMs: number;
  };
}
