/**
 * Tests for the pure project.json fact parser (T2.2).  The host wrapper
 * (`src/artifacts/codedProject.ts`) only does the I/O; every loose-parse
 * rule lives here so it is testable without vscode:
 *   - name fallback when missing / non-string / blank,
 *   - entryPoints[].filePath: only .cs entries, normalized to forward-slash,
 *   - malformed anything → empty set, never throws.
 */
import { describe, expect, it } from 'vitest';
import { parseProjectJson } from '../../../src/model/codedWorkflow/projectInfo';

describe('parseProjectJson — name', () => {
  it('uses the manifest name when present', () => {
    expect(parseProjectJson({ name: 'InvoiceDemo' }, 'dir').name).toBe('InvoiceDemo');
  });

  it('trims surrounding whitespace from the name', () => {
    expect(parseProjectJson({ name: '  Demo  ' }, 'dir').name).toBe('Demo');
  });

  it.each([
    ['missing', {}],
    ['non-string', { name: 42 }],
    ['blank', { name: '   ' }],
    ['null', { name: null }]
  ])('falls back to the directory basename when name is %s', (_label, json) => {
    expect(parseProjectJson(json, 'MyProjectDir').name).toBe('MyProjectDir');
  });
});

describe('parseProjectJson — entry points', () => {
  it('collects .cs entry points with forward-slash normalization', () => {
    const facts = parseProjectJson(
      {
        entryPoints: [
          { filePath: 'Workflows/Main.cs' },
          { filePath: 'Workflows\\SubFlow.cs' },
          { filePath: './Nested/Deep.cs' }
        ]
      },
      'dir'
    );
    expect(facts.entryPointRelPaths).toEqual(
      new Set(['Workflows/Main.cs', 'Workflows/SubFlow.cs', 'Nested/Deep.cs'])
    );
  });

  it('matches the .cs extension case-insensitively', () => {
    const facts = parseProjectJson({ entryPoints: [{ filePath: 'Main.CS' }] }, 'dir');
    expect(facts.entryPointRelPaths).toEqual(new Set(['Main.CS']));
  });

  it('skips non-.cs entry points (xaml projects)', () => {
    const facts = parseProjectJson(
      { entryPoints: [{ filePath: 'Main.xaml' }, { filePath: 'Workflows/Run.cs' }] },
      'dir'
    );
    expect(facts.entryPointRelPaths).toEqual(new Set(['Workflows/Run.cs']));
  });

  it.each([
    ['entryPoints is not an array', { entryPoints: 'Main.cs' }],
    ['entries are not objects', { entryPoints: ['Main.cs', 42, null] }],
    ['filePath is missing', { entryPoints: [{ uniqueId: 'x' }] }],
    ['filePath is not a string', { entryPoints: [{ filePath: 7 }] }],
    ['filePath is empty', { entryPoints: [{ filePath: '' }] }]
  ])('yields an empty set when %s', (_label, json) => {
    expect(parseProjectJson(json, 'dir').entryPointRelPaths.size).toBe(0);
  });
});

describe('parseProjectJson — malformed roots never throw', () => {
  it.each([
    ['undefined (unreadable file)', undefined],
    ['null', null],
    ['a string', 'not json-shaped'],
    ['a number', 12],
    ['an array', [{ name: 'x' }]]
  ])('degrades cleanly when the parsed JSON is %s', (_label, json) => {
    const facts = parseProjectJson(json, 'FallbackDir');
    expect(facts.name).toBe('FallbackDir');
    expect(facts.entryPointRelPaths.size).toBe(0);
  });
});
