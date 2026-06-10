/**
 * ABI smoke test: verifies that `web-tree-sitter@0.26.9` and
 * `tree-sitter-c-sharp@0.23.5` initialise correctly and that the grammar's
 * node/field names match our expectations.
 *
 * This is the permanent tripwire between the two wasm packages.  If either
 * package is upgraded and the node types or field names change in a
 * breaking way, these tests will catch it before any downstream code breaks.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser, disposeCSharpParser } from '../../../src/model/codedWorkflow/parser';
import type { CSharpParserHandle } from '../../../src/model/codedWorkflow/parser';

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let parser: CSharpParserHandle;

beforeAll(async () => {
  configureCSharpParserFromNodeModules();
  parser = await getCSharpParser();
});

// ---------------------------------------------------------------------------
// Test 1: basic parse — root type and error-free tree
// ---------------------------------------------------------------------------

describe('CSharpParser — basic initialisation', () => {
  it('parses a minimal CodedWorkflow class and produces a compilation_unit root with no errors', () => {
    const tree = parser.parse('class A : CodedWorkflow { }');

    // Root node type — grammar entry point for a C# file
    expect(tree.rootNode.type).toBe('compilation_unit');

    // Tree-sitter never throws on bad input; a clean tree has no error nodes
    expect(tree.rootNode.hasError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: grammar node/field name tripwire
// ---------------------------------------------------------------------------

describe('CSharpParser — grammar node/field names (ABI tripwire)', () => {
  it('finds a class_declaration whose "name" field is "A"', () => {
    const tree = parser.parse('class A : CodedWorkflow { }');

    // class_declaration is a direct child of compilation_unit
    const classDecl = tree.rootNode.namedChildren.find(
      (n) => n.type === 'class_declaration'
    );
    expect(classDecl).toBeDefined();

    // "name" is a named field on class_declaration (see node-types.json)
    const nameNode = classDecl!.childForFieldName('name');
    expect(nameNode).not.toBeNull();
    expect(nameNode!.type).toBe('identifier');
    expect(nameNode!.text).toBe('A');
  });

  it('finds a base_list child containing an identifier "CodedWorkflow"', () => {
    const tree = parser.parse('class A : CodedWorkflow { }');

    const classDecl = tree.rootNode.namedChildren.find(
      (n) => n.type === 'class_declaration'
    );
    expect(classDecl).toBeDefined();

    // base_list is a named child (not a field) of class_declaration
    // (node-types.json: children[] includes { "type": "base_list", "named": true })
    const baseList = classDecl!.namedChildren.find(
      (n) => n.type === 'base_list'
    );
    expect(baseList).toBeDefined();

    // base_list children are "type" nodes; each type node's text is the base name
    // Collect all text from named children of base_list
    const baseTypeTexts = baseList!.namedChildren.map((n) => n.text);
    expect(baseTypeTexts).toContain('CodedWorkflow');
  });
});

// ---------------------------------------------------------------------------
// Test 3: singleton — same handle returned on second call
// ---------------------------------------------------------------------------

describe('CSharpParser — singleton contract', () => {
  it('returns the same handle instance on a second getCSharpParser() call', async () => {
    const second = await getCSharpParser();
    expect(second).toBe(parser);
  });
});

// ---------------------------------------------------------------------------
// Test 4: error tolerance — broken source returns a tree with hasError true
// ---------------------------------------------------------------------------

describe('CSharpParser — error tolerance', () => {
  it('returns a tree (not null/throw) for broken source, with rootNode.hasError === true', () => {
    // Missing closing brace — tree-sitter always returns a tree, never throws
    const tree = parser.parse('class A : CodedWorkflow {');
    expect(tree).toBeDefined();
    expect(tree.rootNode.hasError).toBe(true);
  });
});
