/**
 * Pure GRAPH ASSEMBLY for the coded-workflow project map (T2.1, R6):
 * per-file `FileFacts` in, one `CodedProjectGraph` out.  No I/O — the host
 * (T2.2) does discovery/parsing/`xamlFileExists` and stamps `buildMs`.
 *
 * RECORDED PRODUCT INTERPRETATION — never-drop scope
 *   R6's "never silently drop" rule applies to the WORKFLOW-INVOCATION
 *   mechanisms (`workflows.*`, `RunWorkflow*`): dynamic or unmatched targets
 *   become dashed `resolved:false` edges to `unresolved` nodes, because
 *   dropping them would lie about orchestration.  Unmatched helper calls
 *   (`ClassName` not declared in the project — BCL types, NuGet packages)
 *   are NOT edged: edging every C# call would bury the orchestration signal.
 *
 * `workflows.Foo` RESOLUTION
 *   Foo is matched against coded-workflow CLASS NAMES only.  UiPath's
 *   generated `workflows` proxy exposes one member per workflow FILE, named
 *   after its class (`workflows.ValidateInvoice(...)` runs ValidateInvoice.cs);
 *   the proxy has NO member per public method, so indexing method names would
 *   fabricate edges to any class that merely declares a method `Foo`.  Exactly
 *   one owner → solid edge; zero → `unresolved:<Foo>` node + dashed 'no-match';
 *   two+ → dashed edge to EACH candidate, 'ambiguous'.  Self-edges are kept
 *   when real.
 *
 * EDGE SOURCES: only coded-workflow classes originate edges — invocation
 * facts owned by non-workflow classes are ignored (helper classes have no
 * `workflows`/`RunWorkflow` members; they appear only as TARGETS).
 *
 * XAML NODES: literal RunWorkflow targets are normalized (backslashes →
 * forward slashes, leading './' stripped, case-preserving) and deduped into
 * one `xaml:<normRelPath>` node.  When `xamlFileExists` is absent or false
 * the node has no uri and every edge to it is dashed 'target-file-missing'.
 *
 * HELPER NODES: a helper-call resolves when ClassName matches a declared
 * non-workflow project class; with several declaring files (partials) the
 * first in relPath order hosts the node.
 *
 * NODE CAP: over `nodeCap` (default 300) just enough helper-class nodes are
 * dropped first (alphabetically-last first), then unresolved nodes; coded
 * and xaml nodes are never dropped.  Dropped nodes take their edges with
 * them; `truncated` is true iff something was dropped.
 *
 * DETERMINISM: files are processed in sorted normalized-relPath order, so
 * input order never matters.  Output nodes sort by kind (coded-workflow,
 * xaml-workflow, helper-class, unresolved) then label then id; edges by id.
 *
 * PURITY RULE: pure data in, pure data out.  No `vscode`, `fs`, `path`, or
 * `node:*` imports.
 */
import type {
  CodedGraphEdge,
  CodedGraphNode,
  CodedProjectGraph,
  GraphEdgeKind,
  GraphNodeKind
} from './graphTypes';
import { DYNAMIC_WORKFLOW_NAME, type FileFacts, type WorkflowDecl } from './graphFacts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AssembleInput {
  projectName: string;
  projectRootUri: string;
  /** Normalized rel paths of project.json entry points (may be empty). */
  entryPointRelPaths: ReadonlySet<string>;
  files: ReadonlyArray<FileFacts & { uri?: string }>;
  /** Host-supplied existence probe for normalized xaml rel paths. */
  xamlFileExists?: (normRelPath: string) => boolean;
  nodeCap?: number;
}

export const DEFAULT_NODE_CAP = 300;

/** Assemble the project graph.  `buildMs` is left 0 — the host stamps it. */
export function assembleGraph(input: AssembleInput): CodedProjectGraph {
  const files = [...input.files].sort((a, b) => cmp(normPath(a.relPath), normPath(b.relPath)));
  const entrySet = new Set([...input.entryPointRelPaths].map(normPath));

  const nodes = new Map<string, CodedGraphNode>();
  const edges = new Map<string, CodedGraphEdge>();

  // -- Pass 1: coded-workflow nodes + resolution indexes --------------------
  /**
   * workflows.Foo CLASS name → candidate node ids.  UiPath's generated
   * `workflows` proxy exposes one member per workflow CLASS (named after the
   * class that owns the file), so `workflows.Foo` resolves against class names
   * ONLY — indexing public method names here would fabricate edges to any
   * class that merely HAS a method `Foo`.
   */
  const classNameIndex = new Map<string, Set<string>>();
  /** Non-workflow class name → node seed from its first declaring file. */
  const helperSeeds = new Map<string, Omit<CodedGraphNode, 'kind' | 'label' | 'isEntryPoint'>>();
  /** Class names already claimed by a coded-workflow node (partial-class guard). */
  const codedClassNames = new Set<string>();
  /** Ids of coded-workflow nodes — the only legal edge sources. */
  const codedIds = new Set<string>();
  const codedDecls: Array<{ node: CodedGraphNode; relPath: string; decl: WorkflowDecl }> = [];

  let anyAttributeEntry = false;
  for (const file of files) {
    const rel = normPath(file.relPath);
    for (const decl of file.decls) {
      const id = `cs:${rel}#${decl.className}`;
      if (decl.isCodedWorkflow) {
        if (!nodes.has(id)) {
          const node: CodedGraphNode = {
            id,
            kind: 'coded-workflow',
            label: decl.className,
            relPath: rel,
            ...(file.uri !== undefined ? { uri: file.uri } : {}),
            isEntryPoint: false,
            stale: file.parseHadErrors
          };
          nodes.set(id, node);
          codedDecls.push({ node, relPath: rel, decl });
        }
        codedIds.add(id);
        codedClassNames.add(decl.className);
        addCandidate(classNameIndex, decl.className, id);
        if (decl.hasWorkflowAttribute) anyAttributeEntry = true;
      } else if (!helperSeeds.has(decl.className)) {
        helperSeeds.set(decl.className, {
          id,
          relPath: rel,
          ...(file.uri !== undefined ? { uri: file.uri } : {}),
          stale: file.parseHadErrors
        });
      }
    }
  }

  // A class that is coded-workflow in one file and plain in another (partial
  // class) must not also seed a helper node — the coded-workflow node already
  // claims that className.
  for (const className of codedClassNames) helperSeeds.delete(className);

  // -- Entry-point badging ---------------------------------------------------
  if (entrySet.size > 0) {
    for (const e of codedDecls) e.node.isEntryPoint = entrySet.has(e.relPath);
  } else if (anyAttributeEntry) {
    for (const e of codedDecls) e.node.isEntryPoint = e.decl.hasWorkflowAttribute;
  } else {
    // Last-resort heuristic: badge at most ONE class named `Main` (the first in
    // sorted relPath order — `files`/`codedDecls` are already relPath-sorted),
    // not every Main in the project, which would badge several entry points.
    let badgedMain = false;
    for (const e of codedDecls) {
      const isFirstMain = e.decl.className === 'Main' && !badgedMain;
      e.node.isEntryPoint = isFirstMain;
      if (isFirstMain) badgedMain = true;
    }
  }

  // -- Pass 2: edges -----------------------------------------------------------
  for (const file of files) {
    const rel = normPath(file.relPath);
    for (const fact of file.invocations) {
      const sourceId = `cs:${rel}#${fact.ownerClassName}`;
      if (!codedIds.has(sourceId)) continue; // see EDGE SOURCES in the header

      switch (fact.kind) {
        case 'workflows-member': {
          const candidates = [...(classNameIndex.get(fact.calleeName) ?? [])].sort(cmp);
          if (candidates.length === 1) {
            addEdge(edges, sourceId, candidates[0], 'invoke-workflow', true);
          } else if (candidates.length === 0) {
            const target = ensureUnresolved(nodes, fact.calleeName);
            addEdge(edges, sourceId, target, 'invoke-workflow', false, 'no-match');
          } else {
            for (const target of candidates) {
              addEdge(edges, sourceId, target, 'invoke-workflow', false, 'ambiguous');
            }
          }
          break;
        }
        case 'run-workflow': {
          if (!fact.isLiteralArg) {
            const target = ensureUnresolved(nodes, DYNAMIC_WORKFLOW_NAME);
            addEdge(edges, sourceId, target, 'run-xaml', false, 'dynamic-argument');
            break;
          }
          const normRel = normPath(fact.calleeName).replace(/^\.\//, '');
          const id = `xaml:${normRel}`;
          const exists = input.xamlFileExists?.(normRel) ?? false;
          if (!nodes.has(id)) {
            nodes.set(id, {
              id,
              kind: 'xaml-workflow',
              label: normRel.split('/').pop() ?? normRel,
              relPath: normRel,
              ...(exists ? { uri: joinUri(input.projectRootUri, normRel) } : {}),
              isEntryPoint: false,
              stale: false
            });
          }
          addEdge(edges, sourceId, id, 'run-xaml', exists, exists ? undefined : 'target-file-missing');
          break;
        }
        case 'helper-call': {
          const seed = helperSeeds.get(fact.calleeName);
          if (seed === undefined) break; // recorded interpretation: not edged
          if (!nodes.has(seed.id)) {
            nodes.set(seed.id, {
              ...seed,
              kind: 'helper-class',
              label: fact.calleeName,
              isEntryPoint: false
            });
          }
          addEdge(edges, sourceId, seed.id, 'call-helper', true);
          break;
        }
      }
    }
  }

  // -- Node cap ---------------------------------------------------------------
  const cap = input.nodeCap ?? DEFAULT_NODE_CAP;
  let dropped = 0;
  if (nodes.size > cap) {
    dropped += dropOverCap(nodes, edges, 'helper-class', cap);
    if (nodes.size > cap) dropped += dropOverCap(nodes, edges, 'unresolved', cap);
  }

  // -- Deterministic output -----------------------------------------------------
  const nodeList = [...nodes.values()].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || cmp(a.label, b.label) || cmp(a.id, b.id)
  );
  const edgeList = [...edges.values()].sort((a, b) => cmp(a.id, b.id));

  return {
    projectName: input.projectName,
    projectRootUri: input.projectRootUri,
    nodes: nodeList,
    edges: edgeList,
    buildMs: 0,
    truncated: dropped > 0
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const KIND_ORDER: Readonly<Record<GraphNodeKind, number>> = {
  'coded-workflow': 0,
  'xaml-workflow': 1,
  'helper-class': 2,
  unresolved: 3
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Forward slashes; case-preserving. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function joinUri(rootUri: string, relPath: string): string {
  return `${rootUri.replace(/\/+$/, '')}/${relPath}`;
}

function addCandidate(index: Map<string, Set<string>>, name: string, id: string): void {
  const set = index.get(name);
  if (set !== undefined) set.add(id);
  else index.set(name, new Set([id]));
}

function ensureUnresolved(nodes: Map<string, CodedGraphNode>, name: string): string {
  const id = `unresolved:${name}`;
  if (!nodes.has(id)) {
    nodes.set(id, { id, kind: 'unresolved', label: name, isEntryPoint: false, stale: false });
  }
  return id;
}

function addEdge(
  edges: Map<string, CodedGraphEdge>,
  source: string,
  target: string,
  kind: GraphEdgeKind,
  resolved: boolean,
  unresolvedReason?: CodedGraphEdge['unresolvedReason']
): void {
  const id = `${source}->${target}:${kind}`;
  const existing = edges.get(id);
  if (existing !== undefined) {
    existing.count += 1;
    return;
  }
  edges.set(id, {
    id,
    source,
    target,
    kind,
    resolved,
    ...(unresolvedReason !== undefined ? { unresolvedReason } : {}),
    count: 1
  });
}

/**
 * Drop just enough nodes of `kind` (alphabetically-last first, by label then
 * id) to get under the cap, removing every edge that touches a dropped node.
 * Returns the number of nodes dropped.
 */
function dropOverCap(
  nodes: Map<string, CodedGraphNode>,
  edges: Map<string, CodedGraphEdge>,
  kind: GraphNodeKind,
  cap: number
): number {
  const droppable = [...nodes.values()]
    .filter((n) => n.kind === kind)
    .sort((a, b) => cmp(a.label, b.label) || cmp(a.id, b.id));
  let droppedCount = 0;
  while (nodes.size > cap && droppable.length > 0) {
    const victim = droppable.pop();
    if (victim === undefined) break;
    nodes.delete(victim.id);
    droppedCount += 1;
    for (const edge of [...edges.values()]) {
      if (edge.source === victim.id || edge.target === victim.id) {
        edges.delete(edge.id);
      }
    }
  }
  return droppedCount;
}
