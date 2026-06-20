/**
 * Collapse policy for the coded-workflow canvas — pure logic, no DOM.
 *
 * The persisted view state stores a DELTA (`userToggled`: ids whose state the
 * user flipped) rather than the absolute set of collapsed ids. A node's
 * default comes from its kind — chips always default collapsed, containers
 * default to the HOST-computed `collapsedByDefault` — and a user toggle
 * inverts that default. This way a host policy recomputation (e.g. the file
 * grew and more containers default-collapse) never fights saved state: the
 * untouched nodes follow the new defaults, the touched ones keep the user's
 * intent.
 */

export type CollapsibleKind = 'chip' | 'container';

/** Resolves whether a node is currently collapsed. */
export function effectiveCollapsed(
  nodeId: string,
  kind: CollapsibleKind,
  collapsedByDefault: boolean,
  userToggled: ReadonlySet<string>
): boolean {
  const defaultCollapsed = kind === 'chip' ? true : collapsedByDefault;
  return userToggled.has(nodeId) ? !defaultCollapsed : defaultCollapsed;
}

/** Flips an id in the toggle set (mutates `userToggled`). */
export function toggleId(userToggled: Set<string>, id: string): void {
  if (userToggled.has(id)) {
    userToggled.delete(id);
  } else {
    userToggled.add(id);
  }
}
