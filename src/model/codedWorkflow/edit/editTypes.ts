// PURITY: no vscode/fs/path/node:* imports.

/** A minimal text replacement: replace [start,end) char offsets with newText. */
export interface TextPatch { start: number; end: number; newText: string; }

/** L0 intent: change one argument's value on the node identified by `id`. */
export interface EditValueIntent {
  kind: 'editValue';
  id: string;        // stable node id, e.g. `W#Execute/0`
  argIndex: number;  // index into the node's `args`
  newText: string;   // EXACT source text the user wants, e.g. `"Begin"`, `42`, `true`
}

/**
 * L1 intent: structural change to a call's arguments, or its method name.
 * Exactly one operation per intent:
 *  - op 'change'  → replace arg #argIndex's WHOLE argument with `newText`.
 *  - op 'add'     → splice `newText` as a new trailing argument.
 *  - op 'remove'  → delete arg #argIndex (and its separating comma).
 *  - op 'method'  → replace the called method name with `newMethod`
 *                   (overload/method switch; args untouched).
 */
export interface EditArgIntent {
  kind: 'editArg';
  id: string;
  op: 'change' | 'add' | 'remove' | 'method';
  /** Required for 'change' / 'remove'; ignored otherwise. */
  argIndex?: number;
  /** Source text of the new/changed argument (for 'change' / 'add'). */
  newText?: string;
  /** New method name (for 'method'). */
  newMethod?: string;
}

/**
 * Locates a slot (or a method body) for insertion. A method body is referenced
 * with an empty `containerId` (the entry-point/helper body itself); a slot is
 * referenced by its container id + slot role + repeat index.
 */
export interface SlotRef {
  /** Container node id, or '' for the entry-point/helper top-level body. */
  containerId: string;
  /** Method body id (the `<class>#<method>/` prefix without trailing index). Used when containerId === ''. */
  methodId: string;
  /** Slot role (then/else/body/…); omitted for a method body. */
  role?: string;
  /** 0-based occurrence index for repeatable roles (elseif/catch/case). */
  roleIndex?: number;
}

/** L2 intent: insert a new statement into a slot at a position. */
export interface AddStatementIntent {
  kind: 'addStatement';
  slot: SlotRef;
  /** 0-based index within the slot's children to insert BEFORE (length ⇒ append). */
  index: number;
  /** The fully-emitted statement source (already through emitStatement). */
  source: string;
}

/** L2 intent: delete a statement by id. */
export interface DeleteStatementIntent {
  kind: 'deleteStatement';
  id: string;
}

/** L2 intent: move a statement within its slot. */
export interface MoveStatementIntent {
  kind: 'moveStatement';
  id: string;
  /** +1 (down) or -1 (up). Bounds are clamped by the resolver. */
  direction: 1 | -1;
}

export type EditIntent =
  | EditValueIntent
  | EditArgIntent
  | AddStatementIntent
  | DeleteStatementIntent
  | MoveStatementIntent;

export type EditResult =
  | { ok: true; patches: TextPatch[] }
  | { ok: false; error: string };
