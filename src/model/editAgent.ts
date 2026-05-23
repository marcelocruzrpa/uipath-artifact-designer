/**
 * Pure helpers for applying visual edits to agent JSON files.
 * No vscode / Node / DOM dependency.
 */
import type { ArgProperty } from '../util/messages';
import type { ContentToken } from './types';

/** Sets a nested value, creating intermediate objects as needed. Mutates `target`. */
export function setByPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) {
    return;
  }
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = node[key];
    if (!next || typeof next !== 'object') {
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/**
 * Splits prompt text into contentTokens: text outside `{{ }}` becomes
 * `simpleText`, the trimmed contents of `{{ }}` become `variable`.
 */
export function tokenizePrompt(content: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g;
  let lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ type: 'simpleText', rawString: content.slice(lastIndex, index) });
    }
    tokens.push({ type: 'variable', rawString: match[1].trim() });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) {
    tokens.push({ type: 'simpleText', rawString: content.slice(lastIndex) });
  }
  if (tokens.length === 0) {
    tokens.push({ type: 'simpleText', rawString: '' });
  }
  return tokens;
}

/** Sets a message's content and regenerates its contentTokens. Mutates `agentJson`. */
export function applyPrompt(
  agentJson: Record<string, unknown>,
  role: string,
  content: string
): void {
  const messages = Array.isArray(agentJson.messages)
    ? (agentJson.messages as Record<string, unknown>[])
    : [];
  let message = messages.find((m) => m && typeof m === 'object' && m.role === role);
  if (!message) {
    message = { role };
    messages.push(message);
  }
  message.content = content;
  message.contentTokens = tokenizePrompt(content);
  agentJson.messages = messages;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rebuilds the `properties` map from the edited argument list. Each property
 * object is MERGED onto the one already on disk, so unknown / future schema
 * keywords (`default`, `enum`, `format`, custom `x-uipath-*` keys) survive an
 * edit instead of being silently dropped by a from-scratch rebuild.
 */
function buildSchemaProperties(
  properties: ArgProperty[],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const property of properties) {
    const name = property.name.trim();
    if (name.length === 0) {
      continue;
    }
    const prior = existing[name];
    const entry: Record<string, unknown> = isPlainObject(prior) ? { ...prior } : {};
    if (property.type === 'file') {
      // A file argument is a `$ref`; an inline type/description no longer applies.
      delete entry.type;
      delete entry.description;
      entry.$ref = '#/definitions/job-attachment';
    } else {
      delete entry.$ref;
      entry.type = property.type;
      if (property.description.trim().length > 0) {
        entry.description = property.description;
      } else {
        delete entry.description;
      }
    }
    result[name] = entry;
  }
  return result;
}

/**
 * Rebuilds a JSON Schema object's `properties` and `required` from the edited
 * argument list. Preserves the surrounding schema object, any `definitions`
 * block, and per-property unknown fields (see {@link buildSchemaProperties}).
 */
export function applyArgumentsToSchema(
  existing: unknown,
  properties: ArgProperty[],
  required: string[]
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  const priorProps = isPlainObject(base.properties) ? base.properties : {};
  base.type = 'object';
  base.properties = buildSchemaProperties(properties, priorProps);
  if (required.length > 0) {
    base.required = required;
  } else {
    delete base.required;
  }
  return base;
}

/** Serializes a JSON object with 2-space indentation and a trailing newline. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
