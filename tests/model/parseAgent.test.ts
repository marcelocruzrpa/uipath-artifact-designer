/**
 * Tests for the agent JSON parser / detector (`parseAgent.ts`).
 *
 * Covers: lenient JSON parsing (BOM strip, empty input, malformed input) and
 * the low-code-agent detection predicate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLowCodeAgent, parseJsonLoose } from '../../src/model/parseAgent';

const FIXTURES = join(__dirname, '..', 'fixtures');
const agentJson = readFileSync(join(FIXTURES, 'agent.json'), 'utf8');

describe('parseJsonLoose', () => {
  it('parses valid JSON', () => {
    const result = parseJsonLoose(agentJson);
    expect(result.error).toBeNull();
    expect(result.json).not.toBeNull();
    expect((result.json as Record<string, unknown>).type).toBe('lowCode');
  });

  it('strips a leading UTF-8 BOM before parsing', () => {
    const result = parseJsonLoose('﻿{"a":1}');
    expect(result.error).toBeNull();
    expect(result.json).toEqual({ a: 1 });
  });

  it('reports an empty file as an error', () => {
    const result = parseJsonLoose('');
    expect(result.json).toBeNull();
    expect(result.error).toMatch(/empty/i);
  });

  it('reports whitespace-only input as an error', () => {
    expect(parseJsonLoose('   \n  ').error).toMatch(/empty/i);
  });

  it('returns an error for malformed JSON without throwing', () => {
    const result = parseJsonLoose('{ "a": }');
    expect(result.json).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('isLowCodeAgent', () => {
  it('returns true for a low-code agent document', () => {
    expect(isLowCodeAgent(JSON.parse(agentJson))).toBe(true);
  });

  it('returns false for a non-low-code type', () => {
    expect(isLowCodeAgent({ type: 'coded' })).toBe(false);
  });

  it('returns false for a document without a type', () => {
    expect(isLowCodeAgent({})).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(isLowCodeAgent(null)).toBe(false);
    expect(isLowCodeAgent('lowCode')).toBe(false);
    expect(isLowCodeAgent(undefined)).toBe(false);
  });
});
