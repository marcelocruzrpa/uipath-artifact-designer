/**
 * Scale guardrail constants for the Coded Workflow canvas.
 *
 * COLLAPSE RULES (the `collapsedByDefault` pass in buildModel; container
 * depth is 1-based — a container directly in a method body has depth 1).
 * The effective collapse depth is the MINIMUM of a file-level ceiling and a
 * PER-METHOD density rule, so a single dense method (e.g. a REFramework
 * `while`+`switch` state machine) collapses its nested containers even in an
 * otherwise small file, while small/simple workflows stay fully expanded:
 *   File-level ceiling (whole-file totals):
 *   - totalStatements > COLLAPSE_ALL_STATEMENTS  → collapse depth >= 1
 *   - totalStatements > COLLAPSE_STATEMENT_THRESHOLD
 *     or totalLines > COLLAPSE_TOTAL_LINES       → collapse depth >= 2
 *   Per-method density (that method's leaf count):
 *   - method leaves > COLLAPSE_ALL_STATEMENTS    → collapse depth >= 1
 *   - method leaves > COLLAPSE_METHOD_STATEMENTS → collapse depth >= 2
 *   Always, regardless of the above:
 *   - any container nested at depth >= COLLAPSE_DEEP_NESTING → collapsed
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

/** Above this many statements (whole file), nested containers (depth >= 2) collapse. */
export const COLLAPSE_STATEMENT_THRESHOLD = 200;

/** Above this many statements (whole file OR one method), ALL containers (depth >= 1) collapse. */
export const COLLAPSE_ALL_STATEMENTS = 1000;

/** Above this many total lines (whole file), nested containers (depth >= 2) collapse. */
export const COLLAPSE_TOTAL_LINES = 800;

/**
 * Per-method density: a single method with more leaf statements than this
 * collapses its nested containers (depth >= 2) even when the whole file is
 * small. Sized so a dense orchestrator like the Dispatcher's 62-statement
 * REFramework `Main` (a `while`+`switch` state machine) collapses its inner
 * `switch`/`try` blocks for a navigable overview, while a small leaf workflow
 * (a handful of statements) stays fully expanded.
 */
export const COLLAPSE_METHOD_STATEMENTS = 25;

/**
 * Containers nested at or below this 1-based depth are always collapsed by
 * default, independent of statement counts — bounds the "wall of deeply
 * indented cards" on any method, dense or not (a depth-1 top-level frame and a
 * depth-2 child stay visible; depth-3+ folds).
 */
export const COLLAPSE_DEEP_NESTING = 3;

/**
 * A single container spanning more lines than this is always collapsed. Kept
 * above the ~145-150-line REFramework `while`/`switch` frames on purpose: those
 * top-level frames stay visible (the per-method density rule collapses the
 * inner `switch`, not the outer frame), so this only fires on genuinely huge
 * single containers.
 */
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
