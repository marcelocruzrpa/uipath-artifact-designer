/**
 * Scale guardrail constants for the Coded Workflow canvas.
 *
 * `HEADER_MAX_CHARS` and `CHIP_CODE_MAX_LINES` are live; the remaining
 * collapse/truncation thresholds land with the limits pass in Stage D.
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
