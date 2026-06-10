/**
 * Pure data contract for the coded-workflow project call graph (R6).
 *
 * JSON-serializable only — no functions, no Map/Set, no class instances —
 * because this crosses the host→webview `postMessage` boundary.  The file is
 * listed in `tsconfig.webview.json`'s include and the architecture test
 * (`tests/architecture.test.ts`) enforces that it stays free of `vscode`,
 * `fs`, `path`, and `node:*` imports.
 *
 * NEVER-DROP RULE (R6): dynamic or unresolvable workflow invocations become
 * dashed `resolved: false` edges to `unresolved` nodes — they are never
 * silently dropped, because dropping them would lie about orchestration.
 */

export type GraphNodeKind = 'coded-workflow' | 'xaml-workflow' | 'helper-class' | 'unresolved';

export interface CodedGraphNode {
  /** 'cs:<relPath>#<className>' | 'xaml:<normRelPath>' | 'unresolved:<name>' */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Project-relative path (forward slashes); absent for unresolved nodes. */
  relPath?: string;
  /**
   * Absolute file URI string; click opens it.  Absent for unresolved nodes
   * and for xaml-workflow nodes whose file does not exist.
   */
  uri?: string;
  isEntryPoint: boolean;
  /** File had parse errors; outgoing edges are best-effort. */
  stale: boolean;
}

export type GraphEdgeKind = 'invoke-workflow' | 'run-xaml' | 'call-helper';

export interface CodedGraphEdge {
  /** `${source}->${target}:${kind}` — also the dedup key. */
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** false ⇒ rendered dashed, NEVER dropped (R6). */
  resolved: boolean;
  unresolvedReason?: 'dynamic-argument' | 'no-match' | 'ambiguous' | 'target-file-missing';
  /** Call sites collapsed into this edge. */
  count: number;
}

export interface CodedProjectGraph {
  projectName: string;
  projectRootUri: string;
  nodes: CodedGraphNode[];
  edges: CodedGraphEdge[];
  /** Stamped by the host; the pure assembler leaves it 0. */
  buildMs: number;
  /** True when the node cap dropped helper-class / unresolved nodes. */
  truncated: boolean;
}
