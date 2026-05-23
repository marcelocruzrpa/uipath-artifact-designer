/**
 * Tests for the Coded App action-schema parser / editor (`parseCodedApp.ts`).
 *
 * The headline test is the H4 regression: an unknown per-field key
 * (`x-uipath-widget`, `default`, ...) must survive a section edit, which means
 * `buildSectionProperties` merges onto the on-disk object rather than rebuilding
 * it. A type change must still clear stale `items` / `properties`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSectionProperties,
  parseActionField,
  parseActionSchema,
  parseSection
} from '../../src/model/codedApp/parseCodedApp';
import type { ActionFieldEntry } from '../../src/model/types';

const FIXTURES = join(__dirname, '..', 'fixtures');
const actionSchemaJson = JSON.parse(
  readFileSync(join(FIXTURES, 'action-schema.json'), 'utf8')
);

describe('parseActionField', () => {
  it('normalizes a basic field', () => {
    const field = parseActionField({ type: 'string', required: true, description: 'd' });
    expect(field).toEqual({ type: 'string', required: true, description: 'd' });
  });

  it('defaults a missing type to string', () => {
    expect(parseActionField({}).type).toBe('string');
  });

  it('reads items for an array field', () => {
    const field = parseActionField({ type: 'array', items: { type: 'number' } });
    expect(field.items).toEqual({ type: 'number' });
  });

  it('treats a non-object as an empty string field', () => {
    expect(parseActionField(null)).toEqual({ type: 'string' });
  });
});

describe('parseSection / parseActionSchema', () => {
  it('parses a section into ordered field entries', () => {
    const entries = parseSection(actionSchemaJson.inputs);
    expect(entries.map((e) => e.name)).toEqual(['customerName', 'tags']);
    expect(entries[0].field.type).toBe('string');
    expect(entries[0].field.required).toBe(true);
  });

  it('parses all four sections of a document', () => {
    const schema = parseActionSchema(actionSchemaJson);
    expect(Object.keys(schema)).toEqual(['inputs', 'outputs', 'inOuts', 'outcomes']);
    expect(schema.inputs).toHaveLength(2);
    expect(schema.outputs).toHaveLength(1);
    expect(schema.inOuts).toHaveLength(0);
    expect(schema.outcomes[0].name).toBe('approved');
  });
});

describe('buildSectionProperties — H4 round-trip: unknown keys survive an edit', () => {
  it('preserves an unknown per-field key across an edit', () => {
    const existing = {
      customerName: {
        type: 'string',
        required: true,
        description: 'old',
        'x-uipath-widget': 'text-input',
        default: 'Unknown'
      }
    };
    // The editor only owns name/type/required/description/items/properties — it
    // has no notion of `x-uipath-widget` or `default`.
    const edited: ActionFieldEntry[] = [
      { name: 'customerName', field: { type: 'string', required: false, description: 'new' } }
    ];
    const result = buildSectionProperties(edited, existing);
    const prop = result.customerName as Record<string, unknown>;

    expect(prop.description).toBe('new'); // edit applied
    expect(prop.required).toBeUndefined(); // required:false removes the key
    expect(prop['x-uipath-widget']).toBe('text-input'); // unknown key survives
    expect(prop.default).toBe('Unknown'); // unknown key survives
  });

  it('clears stale items when a field stops being an array', () => {
    const existing = { tags: { type: 'array', items: { type: 'string' }, 'x-keep': 1 } };
    const result = buildSectionProperties(
      [{ name: 'tags', field: { type: 'string' } }],
      existing
    );
    const prop = result.tags as Record<string, unknown>;
    expect(prop.type).toBe('string');
    expect(prop.items).toBeUndefined(); // stale items cleared
    expect(prop['x-keep']).toBe(1); // unknown key still survives
  });

  it('clears stale properties when a field stops being an object', () => {
    const existing = {
      payload: { type: 'object', properties: { a: { type: 'string' } } }
    };
    const result = buildSectionProperties(
      [{ name: 'payload', field: { type: 'string' } }],
      existing
    );
    const prop = result.payload as Record<string, unknown>;
    expect(prop.properties).toBeUndefined(); // stale properties cleared
  });

  it('adds items when a field becomes an array', () => {
    const result = buildSectionProperties(
      [{ name: 'tags', field: { type: 'array', items: { type: 'number' } } }],
      {}
    );
    expect((result.tags as Record<string, unknown>).items).toEqual({ type: 'number' });
  });

  it('skips a field with an empty (whitespace-only) name', () => {
    const result = buildSectionProperties([{ name: '  ', field: { type: 'string' } }], {});
    expect(Object.keys(result)).toHaveLength(0);
  });
});
