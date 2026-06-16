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
   * How the value may be edited from a form:
   *   'string'|'number'|'bool'|'enum' → typed field; 'identifier' → text field;
   *   'raw' → raw-text only (expression/interpolated); 'none' → read-only.
   */
  editableKind: 'string' | 'number' | 'bool' | 'enum' | 'identifier' | 'raw' | 'none';
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
   * arg add splices at `argListSpan.end`; a method switch needs the call's
   * function name span (resolved from the source by the host, not stored).
   * Absent for indexer matches (no argument_list) and synthesized cards.
   */
  argListSpan?: OffsetSpan;
}

export interface CwPseudoStep extends CwNodeBase {
  type: 'pseudo';
  tier: 2;
  ruleId: string;
  title: string;
  text: string;
  icon: string;
}

export interface CwRawChip extends CwNodeBase {
  type: 'raw';
  tier: 3;
  code: string;
  lineCount: number;
  statementCount: number;
  codeTruncated: boolean;
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

export interface CwContainer extends CwNodeBase {
  type: 'container';
  kind: CwContainerKind;
  header: string;
  resourceCard?: CwActivityCard;
  slots: CwSlot[];
  collapsedByDefault: boolean;
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
