/**
 * Parity test: every `WebviewToHost` variant declared at compile time must
 * have a runtime case in `validateWebviewMessage`.
 *
 * Why this matters (HF-4): the compile-time discriminated union in
 * `messages.ts` and the runtime `switch (raw.type)` in `validateMessage.ts`
 * are maintained by hand. Adding a new arm to the union without adding a
 * matching validator case fails silently — the host crashes on the first
 * real message. Adding a validator case without an arm gives dead code that
 * type-checks. This test exercises a minimum-valid payload for each declared
 * type so the validator's coverage is enforced as part of the build.
 *
 * Adding a new `WebviewToHost` member: extend `PARITY_FIXTURES` below with a
 * `{ type, minValid }` entry. The test will fail until the validator also
 * recognizes the new type.
 */
import { describe, expect, it } from 'vitest';
import { validateWebviewMessage } from '../../src/util/validateMessage';

/**
 * One minimum-valid payload per `WebviewToHost` variant. Keep this list in
 * lockstep with the union in `src/util/messages.ts`. The point is not to
 * exhaustively test every field — `validateMessage.test.ts` already does
 * that — but to assert that every declared type is *reachable* through the
 * validator.
 */
const PARITY_FIXTURES: Array<{ type: string; minValid: Record<string, unknown> }> = [
  { type: 'ready', minValid: {} },
  { type: 'openResource', minValid: { uri: 'file:///a.json' } },
  { type: 'openParentAgent', minValid: {} },
  { type: 'reopenAsText', minValid: {} },
  {
    type: 'persistViewState',
    minValid: { state: { zoom: 1, panX: 0, panY: 0, selectedId: null } }
  },
  {
    // Same variant with the optional collapsedIds field (coded-workflow
    // collapse state) — duplicates are fine, the declared-vs-fixtured
    // comparison below is set-based.
    type: 'persistViewState',
    minValid: { state: { zoom: 1, panX: 0, panY: 0, selectedId: null, collapsedIds: ['c1'] } }
  },
  { type: 'log', minValid: { level: 'info', message: 'hi' } },
  { type: 'editAgentField', minValid: { path: ['a'], value: 'v' } },
  { type: 'editAgentPrompt', minValid: { role: 'system', content: 'c' } },
  { type: 'editProject', minValid: { field: 'Name', value: 'n' } },
  {
    type: 'editResourceField',
    minValid: { uri: 'file:///a.json', path: ['a'], value: 'v' }
  },
  {
    type: 'editArguments',
    minValid: { direction: 'input', properties: [], required: [] }
  },
  {
    type: 'setActionSchemaSection',
    minValid: { section: 'inputs', fields: [] }
  },
  { type: 'flowSetNodeLabel', minValid: { nodeId: 'n', label: 'L' } },
  { type: 'flowSetNodeInput', minValid: { nodeId: 'n', key: 'k', value: 'v' } },
  { type: 'flowMoveNode', minValid: { nodeId: 'n', x: 0, y: 0 } },
  {
    type: 'flowAddEdge',
    minValid: {
      id: 'e',
      sourceNodeId: 's',
      sourcePort: 'output',
      targetNodeId: 't',
      targetPort: 'input'
    }
  },
  { type: 'flowRemoveEdge', minValid: { edgeId: 'e' } },
  { type: 'flowRemoveNode', minValid: { nodeId: 'n' } },
  { type: 'bpmnSetXml', minValid: { xml: '<bpmn:definitions/>' } },
  {
    type: 'caseAddStage',
    minValid: { stageKind: 'stage', label: 'L', description: 'D', isRequired: true }
  },
  { type: 'caseDeleteStage', minValid: { stageId: 's' } },
  {
    type: 'caseSetStageField',
    minValid: { stageId: 's', field: 'label', value: 'L' }
  },
  { type: 'caseSetTriggerLabel', minValid: { triggerId: 't', label: 'L' } },
  { type: 'caseAddEdge', minValid: { sourceId: 's', targetId: 't', label: 'L' } },
  { type: 'caseDeleteEdge', minValid: { edgeId: 'e' } },
  { type: 'caseSetEdgeLabel', minValid: { edgeId: 'e', label: 'L' } },
  {
    type: 'caseSetConditions',
    minValid: { scope: 'stage-entry', stageId: 's', conditions: [] }
  },
  { type: 'caseSetSlaRules', minValid: { stageId: 's', slaRules: [] } }
];

describe('message-contract parity', () => {
  it.each(PARITY_FIXTURES)(
    'validator accepts a minimum-valid $type message',
    ({ type, minValid }) => {
      const result = validateWebviewMessage({ type, ...minValid });
      expect(result, `validator returned null for ${type} — missing case?`).not.toBeNull();
      expect(result?.type).toBe(type);
    }
  );

  it('every declared WebviewToHost type literal has a parity fixture', () => {
    // Re-extract type literals from messages.ts source. The static analysis
    // catches an unhandled new union member without needing reflection.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'util', 'messages.ts'),
      'utf8'
    );
    // Match the `WebviewToHost` block from `export type WebviewToHost =` to
    // the next blank line followed by `export` (or EOF).
    const blockMatch = source.match(/export\s+type\s+WebviewToHost\s*=([\s\S]+?);\s*\n\s*\n/);
    expect(blockMatch, 'failed to locate WebviewToHost union in messages.ts').not.toBeNull();
    const block = blockMatch![1];
    const typeLiterals = Array.from(block.matchAll(/type:\s*'([a-zA-Z]+)'/g)).map((m) => m[1]);
    const declared = new Set(typeLiterals);
    const fixtured = new Set(PARITY_FIXTURES.map((f) => f.type));

    const missingFromFixtures = [...declared].filter((t) => !fixtured.has(t));
    const extraInFixtures = [...fixtured].filter((t) => !declared.has(t));

    expect(missingFromFixtures, `missing from PARITY_FIXTURES: add ${missingFromFixtures.join(', ')}`).toEqual([]);
    expect(extraInFixtures, `stale fixtures (no longer in union): ${extraInFixtures.join(', ')}`).toEqual([]);
  });
});
