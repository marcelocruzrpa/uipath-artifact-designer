/**
 * T2.3 — pure dagre layout for the project call graph. Runs in the plain
 * Node environment: `graphLayout.ts` has no DOM dependency (dagre is plain
 * JS), which this suite implicitly verifies by importing and executing it.
 */
import { describe, expect, it } from 'vitest';
import type {
  CodedGraphEdge,
  CodedGraphNode,
  CodedProjectGraph,
  GraphEdgeKind,
  GraphNodeKind
} from '../../src/model/codedWorkflow/graph/graphTypes';
import { layoutGraph, nodeSize } from '../../webview/renderers/codedWorkflow/graphLayout';

function node(id: string, kind: GraphNodeKind, extra: Partial<CodedGraphNode> = {}): CodedGraphNode {
  return {
    id,
    kind,
    label: id,
    isEntryPoint: false,
    stale: false,
    ...extra
  };
}

function edge(
  source: string,
  target: string,
  kind: GraphEdgeKind,
  extra: Partial<CodedGraphEdge> = {}
): CodedGraphEdge {
  return {
    id: `${source}->${target}:${kind}`,
    source,
    target,
    kind,
    resolved: true,
    count: 1,
    ...extra
  };
}

/**
 * Mirrors the sampleProject fixture map (see graphAssemble.test.ts):
 * 8 nodes / 7 edges including an ambiguous pair, a legacy xaml, a helper,
 * the dynamic singleton and a no-match target.
 */
function sampleGraph(): CodedProjectGraph {
  const main = 'cs:Workflows/Main.cs#Main';
  return {
    projectName: 'SampleProject',
    projectRootUri: 'file:///c:/proj',
    nodes: [
      node('cs:Workflows/Ambig1.cs#Ambig1', 'coded-workflow', { relPath: 'Workflows/Ambig1.cs' }),
      node('cs:Workflows/Ambig2.cs#Ambig2', 'coded-workflow', { relPath: 'Workflows/Ambig2.cs' }),
      node(main, 'coded-workflow', { relPath: 'Workflows/Main.cs', isEntryPoint: true }),
      node('cs:Workflows/SubFlow.cs#SubFlow', 'coded-workflow', { relPath: 'Workflows/SubFlow.cs' }),
      node('xaml:Legacy/Old.xaml', 'xaml-workflow', { relPath: 'Legacy/Old.xaml' }),
      node('cs:Helpers/MathHelper.cs#MathHelper', 'helper-class', { relPath: 'Helpers/MathHelper.cs' }),
      node('unresolved:(dynamic workflow)', 'unresolved'),
      node('unresolved:Missing', 'unresolved')
    ],
    edges: [
      edge(main, 'cs:Helpers/MathHelper.cs#MathHelper', 'call-helper'),
      edge(main, 'cs:Workflows/Ambig1.cs#Ambig1', 'invoke-workflow', {
        resolved: false,
        unresolvedReason: 'ambiguous'
      }),
      edge(main, 'cs:Workflows/Ambig2.cs#Ambig2', 'invoke-workflow', {
        resolved: false,
        unresolvedReason: 'ambiguous'
      }),
      edge(main, 'cs:Workflows/SubFlow.cs#SubFlow', 'invoke-workflow', { count: 2 }),
      edge(main, 'unresolved:(dynamic workflow)', 'run-xaml', {
        resolved: false,
        unresolvedReason: 'dynamic-argument'
      }),
      edge(main, 'unresolved:Missing', 'invoke-workflow', {
        resolved: false,
        unresolvedReason: 'no-match'
      }),
      edge(main, 'xaml:Legacy/Old.xaml', 'run-xaml')
    ],
    buildMs: 12,
    truncated: false
  };
}

describe('layoutGraph', () => {
  it('is deterministic — two runs over the same graph are identical', () => {
    const a = layoutGraph(sampleGraph());
    const b = layoutGraph(sampleGraph());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('sizes nodes by kind', () => {
    const result = layoutGraph(sampleGraph());
    const byId = new Map(result.nodes.map((p) => [p.node.id, p]));

    expect(nodeSize('coded-workflow')).toEqual({ width: 220, height: 64 });
    expect(nodeSize('xaml-workflow')).toEqual({ width: 200, height: 56 });
    expect(nodeSize('helper-class')).toEqual({ width: 180, height: 44 });
    expect(nodeSize('unresolved')).toEqual({ width: 180, height: 44 });

    const main = byId.get('cs:Workflows/Main.cs#Main')!;
    expect({ width: main.width, height: main.height }).toEqual({ width: 220, height: 64 });
    const xaml = byId.get('xaml:Legacy/Old.xaml')!;
    expect({ width: xaml.width, height: xaml.height }).toEqual({ width: 200, height: 56 });
    const helper = byId.get('cs:Helpers/MathHelper.cs#MathHelper')!;
    expect({ width: helper.width, height: helper.height }).toEqual({ width: 180, height: 44 });
    const unresolved = byId.get('unresolved:Missing')!;
    expect({ width: unresolved.width, height: unresolved.height }).toEqual({
      width: 180,
      height: 44
    });
  });

  it('positions every node inside the reported bounds', () => {
    const result = layoutGraph(sampleGraph());
    expect(result.nodes).toHaveLength(8);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    for (const placed of result.nodes) {
      expect(placed.x).toBeGreaterThanOrEqual(0);
      expect(placed.y).toBeGreaterThanOrEqual(0);
      expect(placed.x + placed.width).toBeLessThanOrEqual(result.width);
      expect(placed.y + placed.height).toBeLessThanOrEqual(result.height);
    }
  });

  it('keeps left-to-right rank order: Main left of its callees', () => {
    const result = layoutGraph(sampleGraph());
    const byId = new Map(result.nodes.map((p) => [p.node.id, p]));
    const main = byId.get('cs:Workflows/Main.cs#Main')!;
    for (const calleeId of [
      'cs:Workflows/SubFlow.cs#SubFlow',
      'xaml:Legacy/Old.xaml',
      'unresolved:Missing'
    ]) {
      expect(byId.get(calleeId)!.x).toBeGreaterThan(main.x + main.width);
    }
  });

  it('routes every edge with at least two finite points', () => {
    const result = layoutGraph(sampleGraph());
    expect(result.edges).toHaveLength(7);
    for (const routed of result.edges) {
      expect(routed.points.length).toBeGreaterThanOrEqual(2);
      for (const point of routed.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
  });

  it('keeps parallel edges of different kinds distinct (multigraph)', () => {
    const graph: CodedProjectGraph = {
      ...sampleGraph(),
      nodes: [node('cs:A.cs#A', 'coded-workflow'), node('cs:B.cs#B', 'coded-workflow')],
      edges: [
        edge('cs:A.cs#A', 'cs:B.cs#B', 'invoke-workflow'),
        edge('cs:A.cs#A', 'cs:B.cs#B', 'call-helper')
      ]
    };
    const result = layoutGraph(graph);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.map((r) => r.edge.id)).toEqual([
      'cs:A.cs#A->cs:B.cs#B:invoke-workflow',
      'cs:A.cs#A->cs:B.cs#B:call-helper'
    ]);
    for (const routed of result.edges) {
      expect(routed.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('survives self-edges (assembly allows them) and still yields points', () => {
    const graph: CodedProjectGraph = {
      ...sampleGraph(),
      nodes: [node('cs:Main.cs#Main', 'coded-workflow')],
      edges: [edge('cs:Main.cs#Main', 'cs:Main.cs#Main', 'invoke-workflow')]
    };
    const result = layoutGraph(graph);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty layout (no NaN bounds) for an empty graph', () => {
    const graph: CodedProjectGraph = { ...sampleGraph(), nodes: [], edges: [] };
    const result = layoutGraph(graph);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
  });
});
