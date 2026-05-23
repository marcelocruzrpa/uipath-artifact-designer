/**
 * Pure parsing / detection helpers for agent.json.
 * No vscode / Node / DOM dependency.
 */

export interface ParseResult {
  json: unknown | null;
  error: string | null;
}

/** Parses JSON text, stripping a leading BOM. Never throws. */
export function parseJsonLoose(text: string): ParseResult {
  let trimmed = text;
  if (trimmed.charCodeAt(0) === 0xfeff) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.trim().length === 0) {
    return { json: null, error: 'File is empty.' };
  }
  try {
    return { json: JSON.parse(trimmed), error: null };
  } catch (e) {
    return { json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Returns true when the parsed JSON looks like a UiPath low-code agent. */
export function isLowCodeAgent(json: unknown): boolean {
  if (!json || typeof json !== 'object') {
    return false;
  }
  const record = json as Record<string, unknown>;
  return record.type === 'lowCode';
}
