/**
 * Unit tests for `requoteString` — re-emitting a C# string literal from edited
 * CONTENT while preserving the original delimiter style.
 *
 * These tests are the safety contract for the "edit content, host auto-quotes"
 * fix: a low-code dev types the message TEXT and the host owns the C# quotes,
 * so a string can never silently decay into a bare identifier.
 *
 * PURITY: `quoting.ts` must import nothing from vscode/fs/path/node.
 */
import { describe, it, expect } from 'vitest';
import { requoteString } from '../../../../src/model/codedWorkflow/edit/quoting';

describe('requoteString', () => {
  it('wraps plain content in a regular double-quoted literal', () => {
    // content: bye  ->  "bye"
    expect(requoteString('bye', '"hi"')).toBe('"bye"');
  });

  it('escapes embedded double quotes for a regular literal', () => {
    // content chars: s a y _ " h i "   ->   "say \"hi\""
    const content = 'say "hi"';
    expect(requoteString(content, '"hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes a backslash for a regular literal', () => {
    // content is the three chars a \ b  ->  "a\\b"
    const content = 'a\\b';
    expect(content.length).toBe(3); // guard: a, backslash, b
    // expected is the five chars: " a \ \ b " plus the wrapping quotes
    expect(requoteString(content, '"x"')).toBe('"a\\\\b"');
  });

  it('preserves a verbatim original: no backslash escaping, only doubled quotes', () => {
    // original delimiter is @"..."; content is the chars C : \ p a t h
    const content = 'C:\\path';
    expect(content.length).toBe(7); // guard: C : \ p a t h
    // verbatim re-emit keeps the backslash literal: @"C:\path"
    expect(requoteString(content, '@"x"')).toBe('@"C:\\path"');
  });

  it('doubles embedded quotes inside a verbatim literal', () => {
    // content chars: s a y _ " h i "  ->  @"say ""hi"""
    const content = 'say "hi"';
    expect(requoteString(content, '@"old"')).toBe('@"say ""hi"""');
  });

  it('escapes newlines/tabs/CR for a regular literal', () => {
    // a real newline + tab in content becomes the escape sequences \n \t
    expect(requoteString('a\nb\tc', '"x"')).toBe('"a\\nb\\tc"');
  });
});
