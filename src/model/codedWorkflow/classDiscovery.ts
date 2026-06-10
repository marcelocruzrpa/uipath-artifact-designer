/**
 * Shared class-discovery helpers for coded-workflow C# trees — the SINGLE
 * home of the CodedWorkflow base-list / entry-attribute logic, consumed by
 * both `buildModel.ts` (canvas model) and `graph/graphFacts.ts` (call-graph
 * facts).  Do not duplicate these rules elsewhere.
 *
 * WORKFLOW-CLASS RULE (same as the corpus spike)
 *   A class is a workflow class when its base list names `CodedWorkflow` as
 *   the last segment of any base type, OR when at least one of its methods
 *   carries a `[Workflow]` / `[TestCase]` attribute (covers partial classes
 *   whose base list lives in another file).
 *
 * BASE-TYPE RULE
 *   `baseTypeOf` returns the source text of the base whose last segment is
 *   `CodedWorkflow` when one exists; otherwise the first base type's text;
 *   otherwise (attribute-only class with no base list) the literal
 *   `'CodedWorkflow'`, since such classes inherit it via another partial.
 *
 * PURITY RULE: this module may import only types from `web-tree-sitter`.
 * No `vscode`, `fs`, `path`, or `node:*` imports — it runs in the extension
 * host and in plain-Node tests alike.
 */
import type { Node } from 'web-tree-sitter';

export interface FoundClass {
  classDecl: Node;
  /** Dotted enclosing namespace, or undefined at the top level. */
  namespace: string | undefined;
}

/**
 * Collect every `class_declaration` in source order, tracking the enclosing
 * (possibly nested) namespace.  Classes nested inside other classes keep the
 * enclosing namespace only — outer class names are not appended.
 *
 * Note: in this grammar version a `file_scoped_namespace_declaration` spans
 * only the `namespace X;` line and the declarations follow as SIBLINGS, so it
 * sets the namespace for the rest of the current scope (we still recurse into
 * it to stay compatible with grammar versions that nest the declarations).
 */
export function collectClasses(node: Node, namespace: string | undefined): FoundClass[] {
  const found: FoundClass[] = [];
  let current = namespace;
  for (const child of node.namedChildren) {
    switch (child.type) {
      case 'file_scoped_namespace_declaration': {
        const name = child.childForFieldName('name')?.text;
        if (name !== undefined) {
          current = current === undefined ? name : `${current}.${name}`;
        }
        found.push(...collectClasses(child, current));
        break;
      }
      case 'namespace_declaration': {
        const name = child.childForFieldName('name')?.text;
        const inner =
          name === undefined ? current : current === undefined ? name : `${current}.${name}`;
        found.push(...collectClasses(child, inner));
        break;
      }
      case 'class_declaration': {
        found.push({ classDecl: child, namespace: current });
        const body = child.childForFieldName('body');
        if (body !== null) found.push(...collectClasses(body, current));
        break;
      }
      case 'declaration_list':
      case 'ERROR':
        found.push(...collectClasses(child, current));
        break;
      default:
        break;
    }
  }
  return found;
}

/** Last identifier segment of a type name (`A.B.CodedWorkflow` → `CodedWorkflow`). */
export function lastTypeNameSegment(node: Node): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text;
    case 'qualified_name': {
      const name = node.childForFieldName('name');
      return name !== null ? lastTypeNameSegment(name) : null;
    }
    case 'generic_name': {
      const id = node.namedChildren.find((c) => c.type === 'identifier');
      return id !== undefined ? id.text : null;
    }
    case 'primary_constructor_base_type': {
      for (const child of node.namedChildren) {
        const seg = lastTypeNameSegment(child);
        if (seg !== null) return seg;
      }
      return null;
    }
    default:
      return null;
  }
}

function baseListOf(classDecl: Node): Node | undefined {
  return classDecl.namedChildren.find((c) => c.type === 'base_list');
}

/** True when the base list names `CodedWorkflow` as its last segment. */
export function extendsCodedWorkflow(classDecl: Node): boolean {
  const baseList = baseListOf(classDecl);
  if (baseList === undefined) return false;
  return baseList.namedChildren.some((base) => lastTypeNameSegment(base) === 'CodedWorkflow');
}

/** Resolve `baseType` per the BASE-TYPE RULE in the module header. */
export function baseTypeOf(classDecl: Node): string {
  const baseList = baseListOf(classDecl);
  if (baseList !== undefined) {
    const matching = baseList.namedChildren.find(
      (base) => lastTypeNameSegment(base) === 'CodedWorkflow'
    );
    if (matching !== undefined) return matching.text;
    const first = baseList.namedChildren[0];
    if (first !== undefined) return first.text;
  }
  return 'CodedWorkflow';
}

/** Direct `method_declaration` children of the class body. */
export function classMethods(classDecl: Node): Node[] {
  const body = classDecl.childForFieldName('body');
  if (body === null) return [];
  return body.namedChildren.filter((c) => c.type === 'method_declaration');
}

/** `'Workflow'` / `'TestCase'` when the method is an entry point, else null. */
export function entryPointAttribute(method: Node): 'Workflow' | 'TestCase' | null {
  for (const child of method.namedChildren) {
    if (child.type !== 'attribute_list') continue;
    for (const attr of child.namedChildren) {
      if (attr.type !== 'attribute') continue;
      const name = attr.childForFieldName('name');
      const seg = name !== null ? lastTypeNameSegment(name) : null;
      if (seg === 'Workflow' || seg === 'TestCase') return seg;
    }
  }
  return null;
}

/** True when any of the class's methods carries `[Workflow]` / `[TestCase]`. */
export function hasEntryPointMethod(classDecl: Node): boolean {
  return classMethods(classDecl).some((m) => entryPointAttribute(m) !== null);
}

/**
 * The WORKFLOW-CLASS RULE as one predicate: base list names `CodedWorkflow`
 * OR any method carries an entry-point attribute.
 */
export function isWorkflowClass(classDecl: Node): boolean {
  return extendsCodedWorkflow(classDecl) || hasEntryPointMethod(classDecl);
}
