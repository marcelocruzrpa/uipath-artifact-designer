import type { CodedWorkflowModel, CwSlot, CwStatement } from '../cwTypes';
import type { SlotRef } from './editTypes';

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

/** A resolved insertion target: the children list + its body interior offsets. */
export interface SlotTarget {
  children: CwStatement[];
  bodySpan?: { start: number; end: number };
  indentText?: string;
}

/** Resolve a SlotRef to the children list + body interior, or null. */
export function findSlot(model: CodedWorkflowModel, ref: SlotRef): SlotTarget | null {
  if (ref.containerId === '') {
    // Match on the EXACT id-prefix buildModel assigned (bodyId), so overloaded
    // methods (`W#Run@2/`) and empty bodies resolve unambiguously.
    for (const cls of model.classes) {
      for (const ep of cls.entryPoints) {
        if (ep.bodyId === ref.methodId) {
          return { children: ep.body, bodySpan: ep.bodySpan, indentText: ep.indentText };
        }
      }
      for (const hm of cls.helperMethods) {
        if (hm.bodyId === ref.methodId) {
          return { children: hm.body, bodySpan: hm.bodySpan, indentText: hm.indentText };
        }
      }
    }
    return null;
  }
  const container = findNodeById(model, ref.containerId);
  if (container === null || container.type !== 'container') return null;
  const slot = matchSlot(container.slots, ref);
  return slot === null
    ? null
    : { children: slot.children, bodySpan: slot.bodySpan, indentText: slot.indentText };
}

function matchSlot(slots: CwSlot[], ref: SlotRef): CwSlot | null {
  const repeatable = new Set(['elseif', 'catch', 'case']);
  let seen = 0;
  for (const slot of slots) {
    if (slot.role !== ref.role) continue;
    if (repeatable.has(slot.role)) {
      if (seen === (ref.roleIndex ?? 0)) return slot;
      seen += 1;
    } else {
      return slot;
    }
  }
  return null;
}

/** Find the sibling list + index containing the statement id (for move/delete). */
export function findSiblings(
  model: CodedWorkflowModel,
  id: string
): { siblings: CwStatement[]; index: number } | null {
  const walk = (stmts: CwStatement[]): { siblings: CwStatement[]; index: number } | null => {
    const i = stmts.findIndex((s) => s.id === id);
    if (i >= 0) return { siblings: stmts, index: i };
    for (const s of stmts) {
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
    for (const ep of cls.entryPoints) { const hit = walk(ep.body); if (hit) return hit; }
    for (const hm of cls.helperMethods) { const hit = walk(hm.body); if (hit) return hit; }
  }
  return null;
}
