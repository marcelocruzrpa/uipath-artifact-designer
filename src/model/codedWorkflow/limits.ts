/**
 * Scale guardrail constants for the Coded Workflow canvas.
 *
 * Stage A ships `HEADER_MAX_CHARS` (container header cap); the remaining
 * collapse/truncation thresholds land with the limits pass in Stage D.
 *
 * PURITY RULE: no imports at all — shared by host, webview, and tests.
 */

/** Container headers/labels are exact source capped at this length + '…'. */
export const HEADER_MAX_CHARS = 80;
