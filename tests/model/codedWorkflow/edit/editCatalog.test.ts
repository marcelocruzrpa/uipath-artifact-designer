import { it, expect } from 'vitest';
import { TIER1_CATALOG, BASE_FAMILY_ID } from '../../../../src/model/codedWorkflow/classify/tier1Catalog';

it('every emit template references {args} and has at least one arg schema', () => {
  for (const family of TIER1_CATALOG) {
    for (const entry of family.entries) {
      if (entry.emit === undefined) continue;
      expect(entry.emit.template, `${family.id}.${entry.method}`).toContain('{args}');
      expect(entry.emit.args.length, `${family.id}.${entry.method}`).toBeGreaterThan(0);
      // A non-base template must reference the receiver placeholder.
      if (family.id !== BASE_FAMILY_ID) {
        expect(entry.emit.template, `${family.id}.${entry.method}`).toContain('{recv}');
      }
    }
  }
});
