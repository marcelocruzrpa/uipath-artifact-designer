/**
 * Pure parsing helpers for a Coded App `action-schema.json` data contract.
 * No vscode / Node / DOM dependency.
 */
import type { ActionField, ActionFieldEntry, ActionSchemaSectionName } from '../types';
import { asRecord } from '../../util/jsonShape';

const SECTION_NAMES: ActionSchemaSectionName[] = ['inputs', 'outputs', 'inOuts', 'outcomes'];

/** Normalizes one raw JSON-schema property into an `ActionField`. */
export function parseActionField(raw: unknown): ActionField {
  const record = asRecord(raw);
  const field: ActionField = { type: typeof record.type === 'string' ? record.type : 'string' };
  if (record.required === true) {
    field.required = true;
  }
  if (typeof record.description === 'string' && record.description.length > 0) {
    field.description = record.description;
  }
  const items = asRecord(record.items);
  if (typeof items.type === 'string') {
    field.items = { type: items.type };
  }
  if (record.properties && typeof record.properties === 'object') {
    field.properties = record.properties as Record<string, unknown>;
  }
  return field;
}

/** Parses one `{ type, properties }` section into ordered field entries. */
export function parseSection(raw: unknown): ActionFieldEntry[] {
  const properties = asRecord(asRecord(raw).properties);
  return Object.keys(properties).map((name) => ({
    name,
    field: parseActionField(properties[name])
  }));
}

/** Parses a whole `action-schema.json` document into its four sections. */
export function parseActionSchema(
  json: unknown
): Record<ActionSchemaSectionName, ActionFieldEntry[]> {
  const root = asRecord(json);
  const result = {} as Record<ActionSchemaSectionName, ActionFieldEntry[]>;
  for (const name of SECTION_NAMES) {
    result[name] = parseSection(root[name]);
  }
  return result;
}

/**
 * Rebuilds a section's `properties` object from edited field entries.
 *
 * Each field object is MERGED onto the one already on disk (`existing`), so
 * unknown / future schema keywords survive an edit instead of being dropped by
 * a from-scratch rebuild. Keys the editor owns (`type`, `required`,
 * `description`, `items`, `properties`) are overwritten or removed to match the
 * edited model; everything else is carried through verbatim.
 */
export function buildSectionProperties(
  fields: ActionFieldEntry[],
  existing: Record<string, unknown> = {}
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const entry of fields) {
    const name = entry.name.trim();
    if (name.length === 0) {
      continue;
    }
    const field = entry.field;
    const prior = existing[name];
    const out: Record<string, unknown> =
      prior && typeof prior === 'object' && !Array.isArray(prior)
        ? { ...(prior as Record<string, unknown>) }
        : {};
    out.type = field.type || 'string';
    if (field.required) {
      out.required = true;
    } else {
      delete out.required;
    }
    if (field.description && field.description.trim().length > 0) {
      out.description = field.description;
    } else {
      delete out.description;
    }
    if (field.type === 'array' && field.items) {
      out.items = { type: field.items.type || 'string' };
    } else {
      delete out.items;
    }
    if (field.type === 'object' && field.properties) {
      out.properties = field.properties;
    } else {
      delete out.properties;
    }
    properties[name] = out;
  }
  return properties;
}
