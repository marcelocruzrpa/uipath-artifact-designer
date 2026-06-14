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

export type EditIntent = EditValueIntent | EditArgIntent; // L2 widens further

export type EditResult =
  | { ok: true; patches: TextPatch[] }
  | { ok: false; error: string };
