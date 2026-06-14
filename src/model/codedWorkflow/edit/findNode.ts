import type { CodedWorkflowModel, CwStatement } from '../cwTypes';

/** Depth-first search for a statement by id, descending container slots. */
export function findNodeById(model: CodedWorkflowModel, id: string): CwStatement | null {
  const walk = (stmts: CwStatement[]): CwStatement | null => {
    for (const s of stmts) {
      if (s.id === id) return s;
      if (s.type === 'container') {
        for (const slot of s.slots) {
          const hit = walk(slot.children);
          if (hit) return hit;
        }
      }
    }
    return null;
  };
  for (const cls of model.classes) {
    for (const ep of cls.entryPoints) {
      const hit = walk(ep.body);
      if (hit) return hit;
    }
    for (const hm of cls.helperMethods) {
      const hit = walk(hm.body);
      if (hit) return hit;
    }
  }
  return null;
}
