/**
 * Tests for the Maestro Case parser (`parseCase.ts`) and mutators (`editCase.ts`).
 *
 * Covers: parsing both wrapper shapes (v19 `{ root, ... }` and v20
 * `{ id, metadata, ... }`), schema detection, and a basic edit round-trip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCaseSchema, parseCase } from '../../src/model/case/parseCase';
import { addStage, deleteStage, serializeJson, setStageField } from '../../src/model/case/editCase';

const FIXTURES = join(__dirname, '..', 'fixtures');
const v19 = readFileSync(join(FIXTURES, 'caseplan.v19.json'), 'utf8');
const v20 = readFileSync(join(FIXTURES, 'caseplan.v20.json'), 'utf8');

describe('parseCase — v19 wrapper', () => {
  it('parses the v19 fixture into a normalized model', () => {
    const { model } = parseCase(v19);
    expect(model.schemaVersion).toBe('v19');
    expect(model.root.name).toBe('Invoice Approval Case');
    expect(model.root.caseAppEnabled).toBe(true);
    expect(model.trigger?.label).toBe('Start');
    expect(model.stages.map((s) => s.label)).toEqual(['Review', 'Approve']);
    expect(model.edges).toHaveLength(2);
  });

  it('detects v19 from a root object', () => {
    expect(detectCaseSchema(JSON.parse(v19))).toBe('v19');
  });
});

describe('parseCase — v20 wrapper', () => {
  it('parses the v20 fixture into a normalized model', () => {
    const { model } = parseCase(v20);
    expect(model.schemaVersion).toBe('v20');
    expect(model.root.name).toBe('Onboarding Case');
    expect(model.root.id).toBe('case-1234567890');
    expect(model.trigger?.serviceType).toBe('Intsvc.EventTrigger');
    expect(model.stages.map((s) => s.label)).toEqual(['Collect Documents']);
  });

  it('detects v20 from a case- prefixed id', () => {
    expect(detectCaseSchema(JSON.parse(v20))).toBe('v20');
  });
});

describe('parseCase — robustness', () => {
  it('handles malformed JSON without throwing', () => {
    const { model, diagnostics } = parseCase('{ not valid');
    expect(model.stages).toHaveLength(0);
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('editCase — basic edit round-trips', () => {
  it('edits a stage label and round-trips through parseCase (v19)', () => {
    const caseJson = JSON.parse(v19) as Record<string, unknown>;
    expect(setStageField(caseJson, 'Stage_AAAAAA', 'label', 'Review Updated')).toBe(true);

    const { model } = parseCase(serializeJson(caseJson));
    const stage = model.stages.find((s) => s.id === 'Stage_AAAAAA');
    expect(stage?.label).toBe('Review Updated');
  });

  it('edits a stage field and round-trips (v20)', () => {
    const caseJson = JSON.parse(v20) as Record<string, unknown>;
    expect(setStageField(caseJson, 'Stage_CCCCCC', 'description', 'Updated desc')).toBe(true);

    const { model } = parseCase(serializeJson(caseJson));
    expect(model.stages[0].description).toBe('Updated desc');
  });

  it('adds a stage and the new stage appears after re-parse', () => {
    const caseJson = JSON.parse(v19) as Record<string, unknown>;
    const newId = addStage(caseJson, { kind: 'stage', label: 'New Stage' });
    expect(newId).toMatch(/^Stage_/);

    const { model } = parseCase(serializeJson(caseJson));
    expect(model.stages.map((s) => s.label)).toContain('New Stage');
  });

  it('deletes a stage and cascades its edges', () => {
    const caseJson = JSON.parse(v19) as Record<string, unknown>;
    expect(deleteStage(caseJson, 'Stage_AAAAAA')).toBe(true);

    const { model } = parseCase(serializeJson(caseJson));
    expect(model.stages.map((s) => s.id)).not.toContain('Stage_AAAAAA');
    // edge_AAAAAA (trigger -> Stage_AAAAAA) and edge_BBBBBB (Stage_AAAAAA ->
    // Stage_BBBBBB) both touch the deleted stage and must be gone.
    expect(model.edges).toHaveLength(0);
  });
});
