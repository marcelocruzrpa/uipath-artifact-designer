/**
 * Keyboard navigation for the graph canvases. Given the focused card and the
 * full set of cards, finds the nearest card in an arrow-key direction so a
 * keyboard user can move focus between nodes without a pointer.
 *
 * Geometry is read from the live `getBoundingClientRect()` of each card, so the
 * logic is independent of the per-canvas layout model and works identically for
 * the agent, flow and case canvases.
 */

/** The four arrow-key directions handled by canvas navigation. */
export type NavDirection = 'left' | 'right' | 'up' | 'down';

/** Maps an arrow-key `KeyboardEvent.key` to a direction, or null if unrelated. */
export function arrowDirection(key: string): NavDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

/** Center point of an element in viewport coordinates. */
function center(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Returns the card nearest to `from` in the given direction, or null when no
 * card lies that way. Candidates are ranked by primary-axis travel plus a
 * weighted cross-axis penalty so the result favors a roughly-aligned neighbor.
 */
export function nearestInDirection(
  from: HTMLElement,
  candidates: Iterable<HTMLElement>,
  direction: NavDirection
): HTMLElement | null {
  const origin = center(from);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (candidate === from) {
      continue;
    }
    const point = center(candidate);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    let primary: number;
    let cross: number;
    if (direction === 'left' || direction === 'right') {
      primary = direction === 'left' ? -dx : dx;
      cross = Math.abs(dy);
    } else {
      primary = direction === 'up' ? -dy : dy;
      cross = Math.abs(dx);
    }
    // Must lie meaningfully in the requested direction.
    if (primary <= 1) {
      continue;
    }
    // Cross-axis travel is penalized so aligned neighbors win.
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
