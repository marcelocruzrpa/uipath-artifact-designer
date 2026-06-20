/**
 * Detection of a bare call to ONE of the SAME class's own helper methods —
 * `SetStatus(...)` or `this.SafeCloseAndKill(...)` — used by `buildModel.ts` to
 * give such a tier-3 chip an in-file "jump to the helper section" affordance.
 *
 * SCOPE (deliberately narrow, to stay honest):
 *   - Only a BARE expression-statement call matches. A BOUND call
 *     (`var r = SetStatus(...)`) already renders as an "Assign" pseudo-step, so
 *     it is left to that rule.
 *   - The callee must be a plain identifier (`Foo(...)`) or a `this.`-prefixed
 *     member call (`this.Foo(...)`) — never a call on some other receiver
 *     (`x.Foo()` could be anything), and never a generic (`Foo<T>()`, rare for
 *     a workflow helper) to keep the match unambiguous.
 *   - The name must be in the caller-supplied set of UNIQUELY-navigable helper
 *     names (built per class: non-entry methods whose simple name is unique and
 *     does not collide with an entry-point name). Ambiguous / unknown names
 *     return null and stay plain raw chips.
 *
 * PURITY RULE: imports only types from `web-tree-sitter`. No `vscode`, `fs`,
 * `path`, or `node:*` imports — runs in the extension host and in plain-Node
 * tests alike.
 */
import type { Node } from 'web-tree-sitter';

/** First named child that is not a comment. */
function firstExpressionChild(node: Node): Node | null {
  return node.namedChildren.find((c) => c.type !== 'comment') ?? null;
}

/**
 * The helper-method name a bare leaf statement calls, when it resolves uniquely
 * to a member of `navigableHelpers`; otherwise null.
 */
export function detectHelperCall(stmt: Node, navigableHelpers: ReadonlySet<string>): string | null {
  if (navigableHelpers.size === 0) return null;
  if (stmt.type !== 'expression_statement') return null;
  const inner = firstExpressionChild(stmt);
  if (inner === null || inner.type !== 'invocation_expression') return null;

  const fn = inner.childForFieldName('function');
  if (fn === null) return null;

  let name: string | null = null;
  if (fn.type === 'identifier') {
    name = fn.text;
  } else if (fn.type === 'member_access_expression') {
    // Only `this.Foo(...)` — a call on any other receiver is not an own-class
    // helper call we can resolve to a rendered Helper section.
    const receiver = fn.childForFieldName('expression');
    const nameNode = fn.childForFieldName('name');
    if (
      receiver !== null &&
      receiver.type === 'this' &&
      nameNode !== null &&
      nameNode.type === 'identifier'
    ) {
      name = nameNode.text;
    }
  }

  return name !== null && navigableHelpers.has(name) ? name : null;
}
