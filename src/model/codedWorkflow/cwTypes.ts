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

/** 0-based lines+cols — matches tree-sitter Point and vscode.Position; UI adds 1 for display. */
export interface SourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface CwArgSummary {
  label: string;
  value: string;
  kind: 'literal' | 'interpolated' | 'identifier' | 'target' | 'expression';
}

interface CwNodeBase {
  id: string;
  span: SourceSpan;
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
}

export interface CwHelperMethod {
  name: string;
  span: SourceSpan;
  body: CwStatement[];
  tierCounts: CwTierCounts;
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
