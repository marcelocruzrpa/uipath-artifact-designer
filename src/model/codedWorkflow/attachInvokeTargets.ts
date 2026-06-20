/**
 * Resolve each invoke ACTIVITY card to its target workflow, reading the outcome
 * straight from the already-assembled project call graph so a card and its graph
 * node always agree. Pure post-pass over the built model: the model builder
 * (`buildModel.ts`) flags invoke activities with `invokeKind`/`invokeCallee` but
 * leaves `invokeTarget` absent (it has no project graph); the host calls this
 * once `model.graph` is available (`artifacts/codedWorkflowDescriptor.ts`).
 *
 * RESOLUTION (mirrors assembleGraph.ts exactly):
 *   - workflows.Foo  → coded-workflow nodes whose label is `Foo`. Exactly one →
 *     'resolved' (its uri); zero → 'no-match'; two+ → 'ambiguous'.
 *   - RunWorkflow("X.xaml") literal → the `xaml:<normRel>` node; uri present →
 *     'resolved', else 'missing-file'.
 *   - RunWorkflow(<non-literal>) → 'dynamic'.
 *
 * PURITY RULE: pure data in, pure data out. No `vscode`, `fs`, `path`, or
 * `node:*` imports.
 */
import type {
  CodedWorkflowModel,
  CwActivityCard,
  CwInvokeTarget,
  CwStatement
} from './cwTypes';
import type { CodedGraphNode, CodedProjectGraph } from './graph/graphTypes';
import { DYNAMIC_WORKFLOW_NAME } from './classify/invokeDetect';

/** Forward slashes; case-preserving — matches assembleGraph's normPath. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Fill `invokeTarget` on every invoke activity card in `model`, using `graph`'s
 * resolved nodes. Mutates the model in place (it is freshly built and owned by
 * the caller). A no-op when there are no invoke activities.
 */
export function attachInvokeTargets(model: CodedWorkflowModel, graph: CodedProjectGraph): void {
  // Index coded-workflow nodes by display label (the `workflows.Foo` resolution
  // name) and every node by id (for `xaml:<rel>` lookups).
  const codedByLabel = new Map<string, CodedGraphNode[]>();
  const nodeById = new Map<string, CodedGraphNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
    if (node.kind === 'coded-workflow') {
      const bucket = codedByLabel.get(node.label);
      if (bucket !== undefined) bucket.push(node);
      else codedByLabel.set(node.label, [node]);
    }
  }

  const resolve = (card: CwActivityCard): CwInvokeTarget => {
    const callee = card.invokeCallee ?? '';
    if (card.invokeKind === 'workflows-member') {
      const candidates = codedByLabel.get(callee) ?? [];
      if (candidates.length === 0) return { status: 'no-match' };
      if (candidates.length > 1) return { status: 'ambiguous' };
      const target = candidates[0];
      return {
        status: 'resolved',
        ...(target.uri !== undefined ? { uri: target.uri } : {}),
        ...(target.relPath !== undefined ? { relPath: target.relPath } : {})
      };
    }
    // run-workflow
    if (callee === DYNAMIC_WORKFLOW_NAME) return { status: 'dynamic' };
    const normRel = normPath(callee).replace(/^\.\//, '');
    const node = nodeById.get(`xaml:${normRel}`);
    if (node?.uri !== undefined) {
      return { status: 'resolved', uri: node.uri, relPath: normRel };
    }
    return { status: 'missing-file', relPath: normRel };
  };

  for (const cls of model.classes) {
    for (const ep of cls.entryPoints) walk(ep.body, resolve);
    for (const hm of cls.helperMethods) walk(hm.body, resolve);
  }
}

/** Depth-first walk over a statement list, resolving invoke activity cards. */
function walk(stmts: CwStatement[], resolve: (card: CwActivityCard) => CwInvokeTarget): void {
  for (const stmt of stmts) {
    if (stmt.type === 'activity') {
      if (stmt.invokeKind !== undefined) stmt.invokeTarget = resolve(stmt);
    } else if (stmt.type === 'container') {
      const rc = stmt.resourceCard;
      if (rc !== undefined && rc.invokeKind !== undefined) rc.invokeTarget = resolve(rc);
      for (const slot of stmt.slots) walk(slot.children, resolve);
    }
  }
}
