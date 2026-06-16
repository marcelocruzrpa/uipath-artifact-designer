/**
 * `applyPatches` overlap guard (resolvers only emit disjoint patches, so an
 * overlap signals an upstream logic bug — it must fail loudly, not silently
 * double-edit or drop a slice).  Adjacent (touching) patches — where one ends
 * exactly where the next begins — are NOT overlapping and must apply cleanly.
 */
import { describe, it, expect } from 'vitest';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';

describe('applyPatches overlap guard', () => {
  it('THROWS when two patches overlap (passed in any order)', () => {
    expect(() =>
      applyPatches('abcdef', [
        { start: 0, end: 3, newText: 'X' },
        { start: 2, end: 4, newText: 'Y' }
      ])
    ).toThrow(/overlapping patches/);
    // Reversed input order still throws (the guard sorts first).
    expect(() =>
      applyPatches('abcdef', [
        { start: 2, end: 4, newText: 'Y' },
        { start: 0, end: 3, newText: 'X' }
      ])
    ).toThrow(/overlapping patches/);
  });

  it('applies ADJACENT (touching) patches without error', () => {
    // [0,2) and [2,4) touch at offset 2 but do not overlap.
    expect(
      applyPatches('abcdef', [
        { start: 0, end: 2, newText: 'X' },
        { start: 2, end: 4, newText: 'Y' }
      ])
    ).toBe('XYef');
  });

  it('applies a single zero-width insertion adjacent to a replacement', () => {
    // A zero-width insert at 2 touching a replacement starting at 2 is adjacent.
    expect(
      applyPatches('abcdef', [
        { start: 2, end: 2, newText: 'INS' },
        { start: 2, end: 4, newText: 'Y' }
      ])
    ).toBe('abINSYef');
  });
});
