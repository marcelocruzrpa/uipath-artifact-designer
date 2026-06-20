/**
 * Test-side snippet utility: wraps C# statements in a minimal CodedWorkflow
 * class, parses with the shared singleton parser, and walks to the method
 * body statements.
 *
 * Node imports allowed here — never shipped in the extension bundle.
 */
import type { Node } from 'web-tree-sitter';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';

export interface ParsedBody {
  /** Full wrapped source text (offsets in `statements` index into this). */
  source: string;
  /** Top-level statements of the Execute() body, comments excluded. */
  statements: Node[];
}

/**
 * Wrap `body` in `class W : CodedWorkflow { [Workflow] public void Execute() { ... } }`,
 * parse it, and return the statement nodes of the method body.
 * Throws if the snippet does not parse cleanly.
 */
export async function parseWorkflowBody(body: string): Promise<ParsedBody> {
  configureCSharpParserFromNodeModules();
  const parser = await getCSharpParser();
  const source = `class W : CodedWorkflow { [Workflow] public void Execute() { ${body} } }`;
  const tree = parser.parse(source);
  if (tree.rootNode.hasError) {
    throw new Error(`snippet failed to parse cleanly: ${body}`);
  }

  const classDecl = tree.rootNode.namedChildren.find(
    (n) => n.type === 'class_declaration'
  );
  const classBody = classDecl?.childForFieldName('body');
  const method = classBody?.namedChildren.find(
    (n) => n.type === 'method_declaration'
  );
  const block = method?.childForFieldName('body');
  if (!block) {
    throw new Error(`could not locate method body for snippet: ${body}`);
  }

  return {
    source,
    statements: block.namedChildren.filter((n) => n.type !== 'comment')
  };
}

/** Parse a snippet expected to contain exactly one statement. */
export async function parseStatement(
  body: string
): Promise<{ source: string; stmt: Node }> {
  const { source, statements } = await parseWorkflowBody(body);
  if (statements.length !== 1) {
    throw new Error(
      `expected exactly one statement, got ${statements.length}: ${body}`
    );
  }
  return { source, stmt: statements[0] };
}
