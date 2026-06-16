/**
 * Scale guardrail constants for the Coded Workflow canvas.
 *
 * COLLAPSE RULES (the `collapsedByDefault` pass in buildModel; container
 * depth is 1-based — a container directly in a method body has depth 1):
 *   - totalStatements > COLLAPSE_ALL_STATEMENTS  → collapse depth >= 1
 *   - totalStatements > COLLAPSE_STATEMENT_THRESHOLD
 *     or totalLines > COLLAPSE_TOTAL_LINES       → collapse depth >= 2
 *   - any container spanning > COLLAPSE_CONTAINER_LINES lines → collapsed
 *   - otherwise expanded.
 *
 * TRUNCATION RULE: beyond MAX_RENDER_STATEMENTS leaf statements per method
 * body, the remaining top-level children fold into ONE terminal raw chip
 * (exact source span of the remainder).  Stats/tierCounts keep the
 * PRE-truncation totals and the fold chip's statementCount carries the
 * folded count, so nothing is ever silently dropped.
 *
 * PURITY RULE: no imports at all — shared by host, webview, and tests.
 */

/** Container headers/labels are exact source capped at this length + '…'. */
export const HEADER_MAX_CHARS = 80;

/**
 * Raw chips carry at most this many code lines; longer chips keep their full
 * span-derived `lineCount` but truncate `code` and set `codeTruncated`.
 */
export const CHIP_CODE_MAX_LINES = 40;

/** Above this many statements, nested containers (depth >= 2) collapse. */
export const COLLAPSE_STATEMENT_THRESHOLD = 200;

/** Above this many statements, ALL containers (depth >= 1) collapse. */
export const COLLAPSE_ALL_STATEMENTS = 1000;

/** Above this many total lines, nested containers (depth >= 2) collapse. */
export const COLLAPSE_TOTAL_LINES = 800;

/** A single container spanning more lines than this is always collapsed. */
export const COLLAPSE_CONTAINER_LINES = 150;

/** Per-method render budget before the remainder folds into one chip. */
export const MAX_RENDER_STATEMENTS = 600;

/**
 * Max container-nesting depth the body walk recurses before folding the
 * remaining subtree into ONE tier-3 raw chip (honest — the raw code is still
 * shown).  Bounds JS recursion so pathologically deep input cannot overflow
 * the stack and violate the never-throws contract.  Real coded workflows nest
 * far shallower than this; the cap only fires on adversarial/generated input.
 */
export const MAX_NESTING_DEPTH = 100;
