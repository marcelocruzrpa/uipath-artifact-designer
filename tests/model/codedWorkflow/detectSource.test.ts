/**
 * Tests for the cheap coded-workflow pre-gate in `detectSource.ts`.
 *
 * The detector must accept both marker forms — a `CodedWorkflow` base list
 * and a `[Workflow]`/`[TestCase]` attribute (which covers partial classes) —
 * and reject ordinary helper files, files that merely import the
 * `UiPath.CodedWorkflows` namespace, and marker-free files.
 */
import { describe, it, expect } from 'vitest';
import { isCodedWorkflowSource } from '../../../src/model/codedWorkflow/detectSource';

describe('isCodedWorkflowSource — accepts', () => {
  it('accepts a class with CodedWorkflow in its base list', () => {
    expect(
      isCodedWorkflowSource('public class MyFlow : CodedWorkflow\n{\n}')
    ).toBe(true);
  });

  it('accepts CodedWorkflow alongside interfaces in the base list', () => {
    expect(
      isCodedWorkflowSource('class X : CodedWorkflow, IDisposable { }')
    ).toBe(true);
  });

  it('accepts a fully-qualified CodedWorkflow base', () => {
    expect(
      isCodedWorkflowSource(
        'class X : UiPath.CodedWorkflows.CodedWorkflow { }'
      )
    ).toBe(true);
  });

  it('accepts an attribute-only partial class via [Workflow]', () => {
    const text = [
      'public partial class MyFlow',
      '{',
      '    [Workflow]',
      '    public void Execute()',
      '    {',
      '    }',
      '}'
    ].join('\n');
    expect(isCodedWorkflowSource(text)).toBe(true);
  });

  it('accepts [TestCase] attribute form', () => {
    expect(
      isCodedWorkflowSource('class T { [TestCase]\npublic void Execute() { } }')
    ).toBe(true);
  });

  it('accepts [Workflow(...)] with arguments', () => {
    expect(
      isCodedWorkflowSource(
        'class T { [Workflow("main")]\npublic void Execute() { } }'
      )
    ).toBe(true);
  });
});

describe('isCodedWorkflowSource — rejects', () => {
  it('rejects an ordinary helper class', () => {
    expect(
      isCodedWorkflowSource(
        'public static class StringHelpers { public static string Trim2(string s) => s.Trim(); }'
      )
    ).toBe(false);
  });

  it('rejects a file that only imports UiPath.CodedWorkflows', () => {
    expect(
      isCodedWorkflowSource(
        'using UiPath.CodedWorkflows;\n\npublic class Helper { }'
      )
    ).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isCodedWorkflowSource('')).toBe(false);
  });

  it('rejects a comment mention without base-list syntax', () => {
    expect(
      isCodedWorkflowSource('// helper used by a CodedWorkflow elsewhere\nclass H { }')
    ).toBe(false);
  });

  it('ignores markers beyond the 2 MB scan window', () => {
    const text = ' '.repeat(2_000_001) + 'class X : CodedWorkflow { }';
    expect(isCodedWorkflowSource(text)).toBe(false);
  });
});
