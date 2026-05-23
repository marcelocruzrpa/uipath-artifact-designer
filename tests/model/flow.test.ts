/**
 * Tests for the Maestro Flow parser (`parseFlow.ts`) and mutators (`editFlow.ts`).
 *
 * Covers: parsing a realistic fixture, dangling-edge detection (a diagnostic +
 * the edge dropped), malformed-JSON handling, and the `removeNode` cascade
 * (edges touching a removed node are also removed).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFlow } from '../../src/model/flow/parseFlow';
import {
  addEdge,
  removeNode,
  serializeJson,
  setNodeLabel
} from '../../src/model/flow/editFlow';

const FIXTURES = join(__dirname, '..', 'fixtures');
const sampleFlow = readFileSync(join(FIXTURES, 'sample.flow'), 'utf8');
const danglingEdgeFlow = readFileSync(join(FIXTURES, 'dangling-edge.flow'), 'utf8');

describe('parseFlow', () => {
  it('parses a well-formed fixture into nodes and edges', () => {
    const result = parseFlow(sampleFlow);
    expect(result.id).toBe('11111111-2222-3333-4444-555555555555');
    expect(result.name).toBe('Sample Flow');
    expect(result.nodes.map((n) => n.id)).toEqual(['trigger-1', 'action-1', 'end-1']);
    expect(result.edges.map((e) => e.id)).toEqual(['edge-1', 'edge-2']);
    expect(result.hasStoredLayout).toBe(true);
  });

  it('classifies node kinds from their type prefix', () => {
    const result = parseFlow(sampleFlow);
    const kinds = Object.fromEntries(result.nodes.map((n) => [n.id, n.kind]));
    expect(kinds['trigger-1']).toBe('trigger');
    expect(kinds['action-1']).toBe('action');
    expect(kinds['end-1']).toBe('end');
  });

  it('parses workflow variables', () => {
    const result = parseFlow(sampleFlow);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toMatchObject({ id: 'var-1', type: 'string' });
  });

  it('drops a dangling edge and emits a diagnostic', () => {
    const result = parseFlow(danglingEdgeFlow);
    expect(result.edges).toHaveLength(0); // the edge to the missing node is dropped
    const warning = result.diagnostics.find((d) => d.severity === 'warning');
    expect(warning).toBeDefined();
    expect(warning?.message).toMatch(/does not exist/i);
  });

  it('handles malformed JSON without throwing', () => {
    const result = parseFlow('{ this is not valid json');
    expect(result.nodes).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('handles a non-object JSON document', () => {
    const result = parseFlow('[]');
    expect(result.nodes).toHaveLength(0);
    expect(result.diagnostics.some((d) => /not a JSON object/i.test(d.message))).toBe(true);
  });
});

describe('editFlow — removeNode cascade', () => {
  it('removes a node and every edge that touches it', () => {
    const flow = JSON.parse(sampleFlow) as Record<string, unknown>;
    const ok = removeNode(flow, 'action-1');
    expect(ok).toBe(true);

    const nodeIds = (flow.nodes as { id: string }[]).map((n) => n.id);
    expect(nodeIds).toEqual(['trigger-1', 'end-1']);

    // edge-1 (trigger-1 -> action-1) and edge-2 (action-1 -> end-1) both touch
    // the removed node and must be dropped.
    const edges = flow.edges as { id: string }[];
    expect(edges).toHaveLength(0);
  });

  it('drops the removed node layout entry', () => {
    const flow = JSON.parse(sampleFlow) as Record<string, unknown>;
    removeNode(flow, 'action-1');
    const layoutNodes = (flow.layout as { nodes: Record<string, unknown> }).nodes;
    expect(layoutNodes['action-1']).toBeUndefined();
    expect(layoutNodes['trigger-1']).toBeDefined();
  });

  it('returns false for an unknown node id', () => {
    const flow = JSON.parse(sampleFlow) as Record<string, unknown>;
    expect(removeNode(flow, 'no-such-node')).toBe(false);
  });
});

describe('editFlow — addEdge / setNodeLabel', () => {
  it('appends a new edge and skips a duplicate', () => {
    const flow = JSON.parse(sampleFlow) as Record<string, unknown>;
    const added = addEdge(flow, {
      id: 'edge-new',
      sourceNodeId: 'trigger-1',
      sourcePort: 'output',
      targetNodeId: 'end-1',
      targetPort: 'input'
    });
    expect(added).toBe(true);
    expect((flow.edges as unknown[]).length).toBe(3);

    const duplicate = addEdge(flow, {
      id: 'edge-dup',
      sourceNodeId: 'trigger-1',
      sourcePort: 'output',
      targetNodeId: 'end-1',
      targetPort: 'input'
    });
    expect(duplicate).toBe(false); // same source/target/ports — not added twice
    expect((flow.edges as unknown[]).length).toBe(3);
  });

  it('sets a node label and round-trips through parseFlow', () => {
    const flow = JSON.parse(sampleFlow) as Record<string, unknown>;
    expect(setNodeLabel(flow, 'action-1', 'Renamed Action')).toBe(true);

    const reparsed = parseFlow(serializeJson(flow));
    const node = reparsed.nodes.find((n) => n.id === 'action-1');
    expect(node?.label).toBe('Renamed Action');
  });
});
