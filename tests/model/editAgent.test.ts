/**
 * Tests for the pure agent-edit helpers (`editAgent.ts`).
 *
 * The headline test here is the H4 regression: an unknown per-property schema
 * field (`default`, `x-uipath-foo`, ...) must SURVIVE an argument edit. The fix
 * merges edits onto the existing property object instead of rebuilding it from
 * the visual model.
 */
import { describe, expect, it } from 'vitest';
import {
  applyArgumentsToSchema,
  serializeJson,
  setByPath
} from '../../src/model/editAgent';
import type { ArgProperty } from '../../src/util/messages';

describe('setByPath', () => {
  it('sets a top-level value', () => {
    const target: Record<string, unknown> = {};
    setByPath(target, ['name'], 'Agent');
    expect(target).toEqual({ name: 'Agent' });
  });

  it('sets a nested value, creating intermediate objects', () => {
    const target: Record<string, unknown> = {};
    setByPath(target, ['settings', 'model'], 'gpt-4o');
    expect(target).toEqual({ settings: { model: 'gpt-4o' } });
  });

  it('overwrites an existing value without disturbing siblings', () => {
    const target: Record<string, unknown> = { settings: { model: 'old', temperature: 0.2 } };
    setByPath(target, ['settings', 'model'], 'new');
    expect(target).toEqual({ settings: { model: 'new', temperature: 0.2 } });
  });

  it('replaces a non-object intermediate with an object', () => {
    const target: Record<string, unknown> = { settings: 'a-string' };
    setByPath(target, ['settings', 'model'], 'gpt-4o');
    expect(target).toEqual({ settings: { model: 'gpt-4o' } });
  });

  it('is a no-op for an empty path', () => {
    const target: Record<string, unknown> = { a: 1 };
    setByPath(target, [], 'x');
    expect(target).toEqual({ a: 1 });
  });
});

describe('applyArgumentsToSchema — H4 round-trip: unknown fields survive an edit', () => {
  it('preserves an unknown per-property field (default) across an edit', () => {
    const existing = {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'old description',
          default: 'fallback-value',
          'x-uipath-foo': 'custom-keyword'
        }
      },
      required: ['input']
    };
    // The visual model only carries name/type/description — it has no notion of
    // `default` or `x-uipath-foo`. A from-scratch rebuild would drop them.
    const edited: ArgProperty[] = [
      { name: 'input', type: 'string', description: 'new description' }
    ];
    const result = applyArgumentsToSchema(existing, edited, ['input']);
    const prop = (result.properties as Record<string, Record<string, unknown>>).input;

    expect(prop.description).toBe('new description'); // edit applied
    expect(prop.default).toBe('fallback-value'); // unknown field survives
    expect(prop['x-uipath-foo']).toBe('custom-keyword'); // unknown field survives
  });

  it('preserves a definitions block on the surrounding schema object', () => {
    const existing = {
      type: 'object',
      properties: {},
      definitions: { 'job-attachment': { type: 'object' } }
    };
    const result = applyArgumentsToSchema(existing, [], []);
    expect(result.definitions).toEqual({ 'job-attachment': { type: 'object' } });
  });

  it('converts a property to a file ($ref) and drops the inline type/description', () => {
    const existing = {
      properties: { att: { type: 'string', description: 'd', 'x-keep': 1 } }
    };
    const result = applyArgumentsToSchema(
      existing,
      [{ name: 'att', type: 'file', description: '' }],
      []
    );
    const prop = (result.properties as Record<string, Record<string, unknown>>).att;
    expect(prop.$ref).toBe('#/definitions/job-attachment');
    expect(prop.type).toBeUndefined();
    expect(prop.description).toBeUndefined();
    expect(prop['x-keep']).toBe(1); // unknown field still survives
  });

  it('drops a stale $ref when a file property becomes a typed property', () => {
    const existing = {
      properties: { att: { $ref: '#/definitions/job-attachment' } }
    };
    const result = applyArgumentsToSchema(
      existing,
      [{ name: 'att', type: 'string', description: 'now a string' }],
      []
    );
    const prop = (result.properties as Record<string, Record<string, unknown>>).att;
    expect(prop.$ref).toBeUndefined();
    expect(prop.type).toBe('string');
  });

  it('sets required when non-empty and removes it when empty', () => {
    const withReq = applyArgumentsToSchema({}, [], ['a']);
    expect(withReq.required).toEqual(['a']);
    const withoutReq = applyArgumentsToSchema({ required: ['a'] }, [], []);
    expect(withoutReq.required).toBeUndefined();
  });

  it('skips properties with an empty (whitespace-only) name', () => {
    const result = applyArgumentsToSchema(
      {},
      [{ name: '   ', type: 'string', description: '' }],
      []
    );
    expect(Object.keys(result.properties as object)).toHaveLength(0);
  });
});

describe('serializeJson', () => {
  it('serializes with 2-space indentation and a trailing newline', () => {
    const out = serializeJson({ a: 1 });
    expect(out).toBe('{\n  "a": 1\n}\n');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('round-trips back to an equal value', () => {
    const value = { name: 'x', nested: { list: [1, 2, 3] } };
    expect(JSON.parse(serializeJson(value))).toEqual(value);
  });
});
