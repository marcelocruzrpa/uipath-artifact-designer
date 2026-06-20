/**
 * Method-local FORWARD tracking of service "handles": variables initialized
 * from a service-rooted invocation (e.g. `var wb = excel.UseExcelFile(...)`)
 * so later member calls on them (`wb.Sheet["S1"].ReadRange()`) resolve to
 * the originating family.
 *
 * Semantics:
 *  - A `variable_declarator` (including inside `using` statements and
 *    `using` declarations) whose initializer is an invocation rooted at a
 *    catalog family — directly or via an already-tracked handle — records
 *    varName → familyId.
 *  - A reassignment (`x = ...` with plain `=`) from a service-rooted
 *    invocation re-binds the handle; from anything else it DELETES the
 *    tracking (the variable no longer holds a service object).
 *  - Declarations whose initializer is not service-rooted clear any stale
 *    tracking under the same name (defensive for shadowing across scopes —
 *    tracking is deliberately flow-insensitive and forward-only).
 *
 * Pure data-in/data-out: the caller walks statements in source order and
 * feeds each one to `trackHandle` before matching it.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */
import type { Node } from 'web-tree-sitter';
import { resolveInvocationFamily } from './tier1Match';

/** varName → familyId */
export type HandleMap = Record<string, string>;

/** Fresh, empty handle map (one per method body). */
export function createHandleMap(): HandleMap {
  return {};
}

/** Record / re-bind / delete the tracking for one variable name. */
function applyBinding(
  map: HandleMap,
  varName: string,
  initializer: Node | null
): void {
  const familyId =
    initializer !== null ? resolveInvocationFamily(initializer, map) : null;
  if (familyId !== null) {
    map[varName] = familyId;
  } else if (varName in map) {
    delete map[varName];
  }
}

/** Process every `variable_declarator` under a `variable_declaration`. */
function trackDeclaration(map: HandleMap, declaration: Node): void {
  for (const declarator of declaration.namedChildren) {
    if (declarator.type !== 'variable_declarator') continue;
    const name = declarator.childForFieldName('name');
    if (name === null) continue;

    const candidates = declarator.namedChildren.filter(
      (c) =>
        c.id !== name.id &&
        c.type !== 'bracketed_argument_list' &&
        c.type !== 'tuple_pattern' &&
        c.type !== 'comment'
    );
    const initializer =
      candidates.length > 0 ? candidates[candidates.length - 1] : null;
    applyBinding(map, name.text, initializer);
  }
}

/**
 * Update `map` with the handle effects of one statement. Statements without
 * handle effects (calls, control flow, ...) are ignored — callers may feed
 * every statement unconditionally.
 */
export function trackHandle(map: HandleMap, stmt: Node): void {
  switch (stmt.type) {
    case 'local_declaration_statement':
    case 'using_statement': {
      // Covers `var x = ...;`, `using var x = ...;`, and
      // `using (var x = ...) { ... }`.
      const declaration = stmt.namedChildren.find(
        (c) => c.type === 'variable_declaration'
      );
      if (declaration !== undefined) {
        trackDeclaration(map, declaration);
      }
      return;
    }
    case 'expression_statement': {
      const inner = stmt.namedChildren.find((c) => c.type !== 'comment');
      if (inner === undefined || inner.type !== 'assignment_expression') {
        return;
      }
      const op = inner.childForFieldName('operator');
      if (op === null || op.text !== '=') return; // compound ops don't re-bind
      const left = inner.childForFieldName('left');
      if (left === null || left.type !== 'identifier') return;
      applyBinding(map, left.text, inner.childForFieldName('right'));
      return;
    }
    default:
      return;
  }
}
