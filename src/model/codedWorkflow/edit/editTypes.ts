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

export type EditIntent = EditValueIntent; // L1/L2 widen this union

export type EditResult =
  | { ok: true; patches: TextPatch[] }
  | { ok: false; error: string };
