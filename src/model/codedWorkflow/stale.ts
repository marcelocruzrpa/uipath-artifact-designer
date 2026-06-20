/**
 * Keep-last-good staleness policy for the Coded Workflow canvas (R8).
 *
 * WHY: the canvas re-renders while the user is typing, and mid-edit source is
 * routinely broken — a half-typed `if (` can make tree-sitter drop most of
 * the file into an ERROR node.  Re-rendering that wreckage would make the
 * canvas flicker between "everything" and "almost nothing" on every
 * keystroke.  Instead, when a fresh parse looks catastrophically worse than
 * the last clean one, we keep showing the last-good model marked `'stale'`
 * and let the user finish typing.
 *
 * THE RULE
 *   - Clean fresh parse (`parseErrorCount === 0`) → always render fresh.
 *   - Broken fresh parse that lost EVERY class, or whose leaf-statement count
 *     collapsed below 50% of the last-good model → render the last-good model
 *     with `parseHealth: 'stale'` (its `staleReason`, if any, is preserved
 *     untouched — this function never sets one). The PROJECT CALL GRAPH is the
 *     one piece carried forward from `fresh`: the active file's statements are
 *     stale, but the just-built project graph reflects every OTHER file's
 *     current state, so it is the freshest graph available — keep it rather
 *     than re-serve the last-good model's older (possibly absent) graph.
 *   - Broken-but-substantial fresh parse → render it as-is (`'partial'`);
 *     localized damage degrades to raw chips, which is more useful than a
 *     frozen stale view.
 *
 * PURITY RULE: no imports beyond local model types; safe for host and tests.
 */
import type { CodedWorkflowModel } from './cwTypes';

/**
 * Decide which model the webview should render: the fresh parse or the
 * last-good model marked stale.  Never mutates either argument.
 */
export function resolveRenderable(
  fresh: CodedWorkflowModel,
  lastGood: CodedWorkflowModel | undefined
): CodedWorkflowModel {
  if (fresh.parseErrorCount === 0) {
    return fresh;
  }
  if (lastGood !== undefined) {
    const collapsed =
      fresh.stats.totalStatements < Math.ceil(lastGood.stats.totalStatements * 0.5);
    if (fresh.classes.length === 0 || collapsed) {
      // Serve the last-good file model but carry the freshly built project
      // graph forward — it reflects the current state of every other file and
      // is more useful than the last-good model's older graph.
      return { ...lastGood, parseHealth: 'stale', graph: fresh.graph };
    }
  }
  return fresh;
}
