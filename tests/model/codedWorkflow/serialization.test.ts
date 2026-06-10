/**
 * Stage-D tests: the CodedWorkflowModel is plain JSON — a stringify/parse
 * round-trip must deep-equal the original (no functions, Maps, undefined
 * properties, or class instances anywhere in the tree).  Runs on the richest
 * fixtures: full container nesting and the card-heavy excel model.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import type { CodedWorkflowModel } from '../../../src/model/codedWorkflow/cwTypes';

beforeAll(() => {
  configureCSharpParserFromNodeModules();
});

async function build(relPath: string): Promise<CodedWorkflowModel> {
  const source = loadFixture(relPath);
  const parser = await getCSharpParser();
  const tree = parser.parse(source);
  try {
    return buildModel(tree, source, {
      fileName: relPath,
      fileUri: `file:///fixtures/${relPath}`
    });
  } finally {
    tree.delete();
  }
}

const RICH_FIXTURES = [
  'skeleton/containers-nesting.cs',
  'skeleton/excel-handles.cs',
  'skeleton/generic-known-service.cs',
  'skeleton/chips-merge.cs'
];

describe('serialization — JSON round-trip', () => {
  for (const fixture of RICH_FIXTURES) {
    it(`round-trips ${fixture} unchanged`, async () => {
      const model = await build(fixture);
      const roundTripped = JSON.parse(JSON.stringify(model));
      expect(roundTripped).toEqual(model);
    });
  }

  it('never carries explicit undefined properties (postMessage hygiene)', async () => {
    const model = await build('skeleton/excel-handles.cs');
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [, v] of Object.entries(value as Record<string, unknown>)) {
          expect(v).not.toBe(undefined);
          visit(v);
        }
      }
    };
    visit(model);
  });
});
