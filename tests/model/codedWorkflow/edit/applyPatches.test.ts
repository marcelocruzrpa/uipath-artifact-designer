import { it, expect } from 'vitest';
import { applyPatches } from '../../../../src/model/codedWorkflow/edit/applyPatches';

it('applies two non-adjacent patches without offset drift', () => {
  // "abcdefgh": replace [1,3)="BC" with "X", [5,7)="FG" with "YY"
  expect(applyPatches('abcdefgh', [
    { start: 1, end: 3, newText: 'X' },
    { start: 5, end: 7, newText: 'YY' }
  ])).toBe('aXdeYYh');
});
