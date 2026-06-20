/**
 * T2.1 — pure graph assembly from synthetic FileFacts (no parser needed),
 * plus an end-to-end block over the real sampleProject fixture.
 *
 * Covers: unique/zero/ambiguous workflows.* resolution, xaml normalization +
 * dedupe + missing-file handling, the dynamic-RunWorkflow singleton, helper
 * edges and the not-edged interpretation, entry-point badging (set →
 * attribute fallback → Main fallback), stale propagation, node cap order
 * (helpers then unresolved), edge count aggregation, and determinism.
 */
import { describe, expect, it } from 'vitest';
import { configureCSharpParserFromNodeModules, loadFixture } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import {
  DYNAMIC_WORKFLOW_NAME,
  extractFileFacts,
  type FileFacts,
  type InvocationFact,
  type WorkflowDecl
} from '../../../src/model/codedWorkflow/graph/graphFacts';
import {
  assembleGraph,
  type AssembleInput
} from '../../../src/model/codedWorkflow/graph/assembleGraph';
import type { CodedProjectGraph } from '../../../src/model/codedWorkflow/graph/graphTypes';

// ---------------------------------------------------------------------------
// Synthetic-facts builders
// ---------------------------------------------------------------------------

function decl(className: string, opts: Partial<WorkflowDecl> = {}): WorkflowDecl {
  return {
    className,
    isCodedWorkflow: true,
    workflowMethods: ['Execute'],
    hasWorkflowAttribute: true,
    ...opts
  };
}

function helperDecl(className: string): WorkflowDecl {
  return decl(className, { isCodedWorkflow: false, hasWorkflowAttribute: false });
}

function inv(
  kind: InvocationFact['kind'],
  calleeName: string,
  ownerClassName: string,
  opts: Partial<InvocationFact> = {}
): InvocationFact {
  return { kind, calleeName, isLiteralArg: true, line: 0, ownerClassName, ...opts };
}

function file(
  relPath: string,
  decls: WorkflowDecl[],
  invocations: InvocationFact[] = [],
  opts: { uri?: string; parseHadErrors?: boolean } = {}
): FileFacts & { uri?: string } {
  return {
    relPath,
    parseHadErrors: opts.parseHadErrors ?? false,
    decls,
    invocations,
    ...(opts.uri !== undefined ? { uri: opts.uri } : {})
  };
}

function assemble(partial: Partial<AssembleInput> & Pick<AssembleInput, 'files'>): CodedProjectGraph {
  return assembleGraph({
    projectName: 'P',
    projectRootUri: 'file:///c:/proj',
    entryPointRelPaths: new Set<string>(),
    ...partial
  });
}

function edgeIds(graph: CodedProjectGraph): string[] {
  return graph.edges.map((e) => e.id);
}

// ---------------------------------------------------------------------------
// workflows.* resolution
// ---------------------------------------------------------------------------

describe('assembleGraph — partial-class edge sources (#5)', () => {
  it('attaches edges from a partial fragment lacking the base list/attribute', () => {
    const graph = assemble({
      files: [
        // The recognized fragment: Worker is a coded workflow here.
        file('Workflows/Worker.Main.cs', [decl('Worker')]),
        // The plain partial fragment: no base list / [Workflow] attr, but it
        // holds the orchestration call, owned by the coded Worker class.
        file('Workflows/Worker.Steps.cs', [helperDecl('Worker')], [
          inv('workflows-member', 'SubFlow', 'Worker')
        ]),
        file('Workflows/SubFlow.cs', [decl('SubFlow')])
      ]
    });
    const worker = 'cs:Workflows/Worker.Main.cs#Worker';
    const subflow = 'cs:Workflows/SubFlow.cs#SubFlow';
    const edge = graph.edges.find((e) => e.source === worker && e.target === subflow);
    expect(edge, 'partial-fragment call should attach to the canonical coded node').toBeDefined();
    expect(edge!.kind).toBe('invoke-workflow');
  });

  it('drops (does NOT fabricate) the edge when the owner name is ambiguous across coded nodes', () => {
    const graph = assemble({
      files: [
        // TWO genuinely distinct coded classes named Worker.
        file('A/Worker.cs', [decl('Worker')]),
        file('B/Worker.cs', [decl('Worker')]),
        // A plain fragment whose owner `Worker` is now ambiguous.
        file('C/Worker.Steps.cs', [helperDecl('Worker')], [
          inv('workflows-member', 'SubFlow', 'Worker')
        ]),
        file('SubFlow.cs', [decl('SubFlow')])
      ]
    });
    // No invoke-workflow edge to SubFlow may be fabricated under ambiguity.
    const fabricated = graph.edges.filter(
      (e) => e.target === 'cs:SubFlow.cs#SubFlow' && e.kind === 'invoke-workflow'
    );
    expect(fabricated).toHaveLength(0);
  });
});

describe('assembleGraph — duplicate class names in one file (#7)', () => {
  async function factsFor(relPath: string, src: string): Promise<FileFacts> {
    configureCSharpParserFromNodeModules();
    const tree = (await getCSharpParser()).parse(src);
    try {
      return { ...extractFileFacts(relPath, src, tree) };
    } finally {
      tree.delete();
    }
  }

  it('does NOT fabricate an edge from a nested class that shares the outer name', async () => {
    // Outer `Wf` is the coded workflow; a NESTED class also named `Wf` makes the
    // call. Pre-fix both collapsed to `cs:F.cs#Wf`, fabricating a Wf->Payroll
    // edge the outer Execute body never makes.
    const facts = await factsFor('F.cs', [
      'namespace P {',
      '  public class Wf : CodedWorkflow {',
      '    [Workflow] public void Execute() { Log("x"); }',
      '    class Wf { public void Helper() { workflows.Payroll(); } }',
      '  }',
      '}'
    ].join('\n'));
    const graph = assemble({ files: [facts] });
    expect(graph.nodes.some((n) => n.id === 'cs:F.cs#Wf')).toBe(true); // outer coded node
    // No fabricated Payroll node or edge sourced from the outer Wf.
    expect(graph.nodes.some((n) => n.id.includes('Payroll'))).toBe(false);
    expect(graph.edges.some((e) => e.target.includes('Payroll'))).toBe(false);
  });

  it('keeps two same-named coded classes (different namespaces) as DISTINCT nodes/sources', async () => {
    const facts = await factsFor('F.cs', [
      'namespace A { public class W : CodedWorkflow { [Workflow] public void Execute() { workflows.Alpha(); } } }',
      'namespace B { public class W : CodedWorkflow { [Workflow] public void Execute() { workflows.Beta(); } } }'
    ].join('\n'));
    const graph = assemble({ files: [facts] });
    // Two distinct coded nodes, both labelled W, with disambiguated ids.
    expect(graph.nodes.filter((n) => n.kind === 'coded-workflow' && n.label === 'W')).toHaveLength(2);
    expect(graph.nodes.some((n) => n.id === 'cs:F.cs#W')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'cs:F.cs#W@2')).toBe(true);
    // Each call is sourced from ITS OWN class, not merged onto the first.
    expect(graph.edges.find((e) => e.target.includes('Alpha'))?.source).toBe('cs:F.cs#W');
    expect(graph.edges.find((e) => e.target.includes('Beta'))?.source).toBe('cs:F.cs#W@2');
  });
});

describe('assembleGraph — entry-point case folding (#11)', () => {
  const files = [file('Workflows/Main.cs', [decl('Main')])];
  const node = (g: CodedProjectGraph) =>
    g.nodes.find((n) => n.id === 'cs:Workflows/Main.cs#Main');

  it('badges an entry point despite project.json↔disk case drift when case-insensitive', () => {
    // Manifest says `main.cs`; disk is `Main.cs`.
    const g = assemble({
      files,
      entryPointRelPaths: new Set(['Workflows/main.cs']),
      pathsCaseInsensitive: true
    });
    expect(node(g)?.isEntryPoint).toBe(true);
  });

  it('stays case-sensitive by default (no fold) — drift does not badge', () => {
    const g = assemble({ files, entryPointRelPaths: new Set(['Workflows/main.cs']) });
    expect(node(g)?.isEntryPoint).toBe(false);
  });
});

describe('assembleGraph — workflows.* resolution', () => {
  it('resolves a unique class-name match to a solid invoke-workflow edge', () => {
    const graph = assemble({
      files: [
        file('Workflows/Main.cs', [decl('Main')], [inv('workflows-member', 'SubFlow', 'Main')]),
        file('Workflows/SubFlow.cs', [decl('SubFlow')])
      ]
    });
    expect(graph.edges).toEqual([
      {
        id: 'cs:Workflows/Main.cs#Main->cs:Workflows/SubFlow.cs#SubFlow:invoke-workflow',
        source: 'cs:Workflows/Main.cs#Main',
        target: 'cs:Workflows/SubFlow.cs#SubFlow',
        kind: 'invoke-workflow',
        resolved: true,
        count: 1
      }
    ]);
  });

  it('resolves a unique CLASS-name match to a solid edge', () => {
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main')], [inv('workflows-member', 'Other', 'Main')]),
        file('Other.cs', [decl('Other', { workflowMethods: ['Execute', 'DoThing'] })])
      ]
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({ target: 'cs:Other.cs#Other', resolved: true })
    ]);
  });

  it('does NOT fabricate an edge from a public-method name (class-name resolution only)', () => {
    // `workflows.DoThing` matches no CLASS named DoThing — the `workflows`
    // proxy exposes one member per workflow CLASS, not per method, so this must
    // be an unresolved no-match, never a solid edge to a class that merely HAS
    // a method DoThing.
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main')], [inv('workflows-member', 'DoThing', 'Main')]),
        file('Other.cs', [decl('Other', { workflowMethods: ['Execute', 'DoThing'] })])
      ]
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({
        target: 'unresolved:DoThing',
        kind: 'invoke-workflow',
        resolved: false,
        unresolvedReason: 'no-match'
      })
    ]);
  });

  it('keeps zero-match calls as dashed edges to an unresolved node (never dropped)', () => {
    const graph = assemble({
      files: [file('Main.cs', [decl('Main')], [inv('workflows-member', 'Missing', 'Main')])]
    });
    const unresolved = graph.nodes.find((n) => n.id === 'unresolved:Missing');
    expect(unresolved).toEqual({
      id: 'unresolved:Missing',
      kind: 'unresolved',
      label: 'Missing',
      isEntryPoint: false,
      stale: false
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({
        target: 'unresolved:Missing',
        kind: 'invoke-workflow',
        resolved: false,
        unresolvedReason: 'no-match'
      })
    ]);
  });

  it('fans ambiguous calls out as dashed edges to EACH candidate (same CLASS name in two files)', () => {
    // Two distinct files each declare a class named `Shared` — `workflows.Shared`
    // cannot pick one, so it fans out to both as dashed 'ambiguous' edges.
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main')], [inv('workflows-member', 'Shared', 'Main')]),
        file('A.cs', [decl('Shared', { workflowMethods: ['Execute'] })]),
        file('B.cs', [decl('Shared', { workflowMethods: ['Execute'] })])
      ]
    });
    const ambiguous = graph.edges.filter((e) => e.unresolvedReason === 'ambiguous');
    expect(ambiguous.map((e) => e.target).sort()).toEqual(['cs:A.cs#Shared', 'cs:B.cs#Shared']);
    expect(ambiguous.every((e) => !e.resolved && e.kind === 'invoke-workflow')).toBe(true);
  });

  it('allows real self-edges', () => {
    const graph = assemble({
      files: [file('Main.cs', [decl('Main')], [inv('workflows-member', 'Main', 'Main')])]
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: 'cs:Main.cs#Main',
        target: 'cs:Main.cs#Main',
        resolved: true
      })
    ]);
  });
});

// ---------------------------------------------------------------------------
// RunWorkflow → xaml nodes
// ---------------------------------------------------------------------------

describe('assembleGraph — RunWorkflow', () => {
  it('normalizes and dedupes xaml literals into one node', () => {
    const graph = assemble({
      files: [
        file(
          'Main.cs',
          [decl('Main')],
          [
            inv('run-workflow', 'Legacy\\Old.xaml', 'Main'),
            inv('run-workflow', 'Legacy/Old.xaml', 'Main')
          ]
        )
      ],
      xamlFileExists: () => true
    });
    const xamlNodes = graph.nodes.filter((n) => n.kind === 'xaml-workflow');
    expect(xamlNodes).toHaveLength(1);
    expect(xamlNodes[0]).toEqual({
      id: 'xaml:Legacy/Old.xaml',
      kind: 'xaml-workflow',
      label: 'Old.xaml',
      relPath: 'Legacy/Old.xaml',
      uri: 'file:///c:/proj/Legacy/Old.xaml',
      isEntryPoint: false,
      stale: false
    });
    // Two call sites collapse into one solid edge with count 2.
    expect(graph.edges).toEqual([
      expect.objectContaining({ kind: 'run-xaml', resolved: true, count: 2 })
    ]);
  });

  it('marks edges to missing xaml files target-file-missing and omits the uri', () => {
    const graph = assemble({
      files: [file('Main.cs', [decl('Main')], [inv('run-workflow', 'Gone.xaml', 'Main')])],
      xamlFileExists: () => false
    });
    const node = graph.nodes.find((n) => n.id === 'xaml:Gone.xaml');
    expect(node?.uri).toBeUndefined();
    expect(graph.edges).toEqual([
      expect.objectContaining({ resolved: false, unresolvedReason: 'target-file-missing' })
    ]);
  });

  it('treats an absent xamlFileExists callback as file-missing', () => {
    const graph = assemble({
      files: [file('Main.cs', [decl('Main')], [inv('run-workflow', 'X.xaml', 'Main')])]
    });
    expect(graph.edges[0].unresolvedReason).toBe('target-file-missing');
  });

  it('routes all dynamic RunWorkflow calls to ONE singleton unresolved node', () => {
    const graph = assemble({
      files: [
        file(
          'Main.cs',
          [decl('Main')],
          [inv('run-workflow', DYNAMIC_WORKFLOW_NAME, 'Main', { isLiteralArg: false })]
        ),
        file(
          'Other.cs',
          [decl('Other')],
          [inv('run-workflow', DYNAMIC_WORKFLOW_NAME, 'Other', { isLiteralArg: false })]
        )
      ]
    });
    const dynamicNodes = graph.nodes.filter((n) => n.kind === 'unresolved');
    expect(dynamicNodes).toEqual([
      expect.objectContaining({ id: `unresolved:${DYNAMIC_WORKFLOW_NAME}` })
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(
      graph.edges.every((e) => !e.resolved && e.unresolvedReason === 'dynamic-argument')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper classes
// ---------------------------------------------------------------------------

describe('assembleGraph — helper calls', () => {
  it('edges helper calls that match a declared non-workflow class', () => {
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main')], [inv('helper-call', 'MathHelper', 'Main')]),
        file('Helpers/MathHelper.cs', [helperDecl('MathHelper')], [], {
          uri: 'file:///c:/proj/Helpers/MathHelper.cs'
        })
      ]
    });
    expect(graph.nodes.filter((n) => n.kind === 'helper-class')).toEqual([
      {
        id: 'cs:Helpers/MathHelper.cs#MathHelper',
        kind: 'helper-class',
        label: 'MathHelper',
        relPath: 'Helpers/MathHelper.cs',
        uri: 'file:///c:/proj/Helpers/MathHelper.cs',
        isEntryPoint: false,
        stale: false
      }
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ kind: 'call-helper', resolved: true })
    ]);
  });

  it('does NOT edge helper calls to unknown classes (recorded interpretation)', () => {
    const graph = assemble({
      files: [file('Main.cs', [decl('Main')], [inv('helper-call', 'Console', 'Main')])]
    });
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((n) => n.kind)).toEqual(['coded-workflow']);
  });

  it('does not create nodes for declared helpers nobody calls', () => {
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main')]),
        file('Helpers/Unused.cs', [helperDecl('Unused')])
      ]
    });
    expect(graph.nodes.filter((n) => n.kind === 'helper-class')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Entry points, stale, uris
// ---------------------------------------------------------------------------

describe('assembleGraph — entry points and stale', () => {
  it('badges entry points from entryPointRelPaths', () => {
    const graph = assemble({
      entryPointRelPaths: new Set(['Workflows/Main.cs']),
      files: [
        file('Workflows/Main.cs', [decl('Main', { hasWorkflowAttribute: false })]),
        file('Workflows/Sub.cs', [decl('Sub')])
      ]
    });
    expect(graph.nodes.find((n) => n.label === 'Main')?.isEntryPoint).toBe(true);
    expect(graph.nodes.find((n) => n.label === 'Sub')?.isEntryPoint).toBe(false);
  });

  it('falls back to hasWorkflowAttribute when the set is empty', () => {
    const graph = assemble({
      files: [
        file('A.cs', [decl('A', { hasWorkflowAttribute: true })]),
        file('B.cs', [decl('B', { hasWorkflowAttribute: false })])
      ]
    });
    expect(graph.nodes.find((n) => n.label === 'A')?.isEntryPoint).toBe(true);
    expect(graph.nodes.find((n) => n.label === 'B')?.isEntryPoint).toBe(false);
  });

  it('falls back to a class named Main when nothing has the attribute', () => {
    const graph = assemble({
      files: [
        file('Main.cs', [decl('Main', { hasWorkflowAttribute: false })]),
        file('Other.cs', [decl('Other', { hasWorkflowAttribute: false })])
      ]
    });
    expect(graph.nodes.find((n) => n.label === 'Main')?.isEntryPoint).toBe(true);
    expect(graph.nodes.find((n) => n.label === 'Other')?.isEntryPoint).toBe(false);
  });

  it('propagates parseHadErrors to node.stale and carries file uris', () => {
    const graph = assemble({
      files: [
        file('Bad.cs', [decl('Bad')], [], {
          parseHadErrors: true,
          uri: 'file:///c:/proj/Bad.cs'
        })
      ]
    });
    expect(graph.nodes[0]).toEqual(
      expect.objectContaining({ stale: true, uri: 'file:///c:/proj/Bad.cs' })
    );
  });
});

// ---------------------------------------------------------------------------
// Node cap, aggregation, determinism
// ---------------------------------------------------------------------------

describe('assembleGraph — cap, aggregation, determinism', () => {
  function capFixture(): Array<FileFacts & { uri?: string }> {
    return [
      file(
        'Main.cs',
        [decl('Main')],
        [
          inv('helper-call', 'Helper1', 'Main'),
          inv('helper-call', 'Helper2', 'Main'),
          inv('workflows-member', 'Missing1', 'Main'),
          inv('workflows-member', 'Missing2', 'Main'),
          inv('workflows-member', 'Sub', 'Main')
        ]
      ),
      file('Sub.cs', [decl('Sub')]),
      file('H1.cs', [helperDecl('Helper1')]),
      file('H2.cs', [helperDecl('Helper2')])
    ];
  }

  it('drops helper-class nodes first when over the cap, with their edges', () => {
    // 6 nodes total: 2 coded + 2 helper + 2 unresolved. Cap 4 → both helpers go.
    const graph = assemble({ files: capFixture(), nodeCap: 4 });
    expect(graph.truncated).toBe(true);
    expect(graph.nodes.filter((n) => n.kind === 'helper-class')).toEqual([]);
    expect(graph.nodes.filter((n) => n.kind === 'unresolved')).toHaveLength(2);
    expect(graph.edges.every((e) => e.kind !== 'call-helper')).toBe(true);
    // Coded nodes and their edges survive.
    expect(edgeIds(graph)).toContain('cs:Main.cs#Main->cs:Sub.cs#Sub:invoke-workflow');
  });

  it('then drops unresolved nodes when helpers alone are not enough', () => {
    // Cap 3 → both helpers AND one unresolved node go (coded nodes never).
    const graph = assemble({ files: capFixture(), nodeCap: 3 });
    expect(graph.truncated).toBe(true);
    expect(graph.nodes.filter((n) => n.kind === 'helper-class')).toEqual([]);
    expect(graph.nodes.filter((n) => n.kind === 'unresolved')).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.kind === 'coded-workflow')).toHaveLength(2);
    // No dangling edges.
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it('does not truncate at or under the cap', () => {
    const graph = assemble({ files: capFixture(), nodeCap: 6 });
    expect(graph.truncated).toBe(false);
    expect(graph.nodes).toHaveLength(6);
  });

  it('aggregates repeated call sites into one edge with a count', () => {
    const graph = assemble({
      files: [
        file(
          'Main.cs',
          [decl('Main')],
          [
            inv('workflows-member', 'Sub', 'Main', { line: 3 }),
            inv('workflows-member', 'Sub', 'Main', { line: 9 })
          ]
        ),
        file('Sub.cs', [decl('Sub')])
      ]
    });
    expect(graph.edges).toEqual([expect.objectContaining({ count: 2, resolved: true })]);
  });

  it('is deterministic: identical output across runs and input file order', () => {
    const files = capFixture();
    const a = assemble({ files });
    const b = assemble({ files: [...files].reverse() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Nodes sorted by kind then label; edges by id.
    const kinds = a.nodes.map((n) => n.kind);
    expect(kinds).toEqual([...kinds].sort((x, y) => {
      const order = ['coded-workflow', 'xaml-workflow', 'helper-class', 'unresolved'];
      return order.indexOf(x) - order.indexOf(y);
    }));
    expect(edgeIds(a)).toEqual([...edgeIds(a)].sort());
  });

  it('leaves buildMs 0 for the host to stamp', () => {
    const graph = assemble({ files: [file('Main.cs', [decl('Main')])] });
    expect(graph.buildMs).toBe(0);
  });

  it('ignores invocations owned by non-workflow classes (no source node)', () => {
    const graph = assemble({
      files: [
        file('H.cs', [helperDecl('Helper')], [inv('workflows-member', 'Sub', 'Helper')]),
        file('Sub.cs', [decl('Sub')])
      ]
    });
    expect(graph.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end over the sampleProject fixture (real parses)
// ---------------------------------------------------------------------------

describe('assembleGraph — sampleProject fixture end-to-end', () => {
  const FIXTURE_FILES = [
    'sampleProject/Workflows/Main.cs',
    'sampleProject/Workflows/SubFlow.cs',
    'sampleProject/Workflows/Ambig1.cs',
    'sampleProject/Workflows/Ambig2.cs',
    'sampleProject/Helpers/MathHelper.cs'
  ];

  async function buildFixtureGraph(): Promise<CodedProjectGraph> {
    configureCSharpParserFromNodeModules();
    const parser = await getCSharpParser();
    const files = FIXTURE_FILES.map((fixturePath) => {
      const relPath = fixturePath.replace('sampleProject/', '');
      const source = loadFixture(fixturePath);
      const tree = parser.parse(source);
      try {
        return { ...extractFileFacts(relPath, source, tree), uri: `file:///c:/proj/${relPath}` };
      } finally {
        tree.delete();
      }
    });
    return assembleGraph({
      projectName: 'SampleProject',
      projectRootUri: 'file:///c:/proj',
      entryPointRelPaths: new Set(['Workflows/Main.cs']),
      files,
      xamlFileExists: (p) => p === 'Legacy/Old.xaml'
    });
  }

  it('produces the expected project map', async () => {
    const graph = await buildFixtureGraph();

    expect(graph.truncated).toBe(false);
    // `Shared` exists only as a METHOD on Ambig1/Ambig2, never as a workflow
    // CLASS, so `workflows.Shared` resolves to NO class — a single dashed
    // `unresolved:Shared` no-match edge, NOT fabricated ambiguous edges to the
    // two classes that merely declare a method of that name (HONESTY-6).
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'cs:Workflows/Ambig1.cs#Ambig1',
      'cs:Workflows/Ambig2.cs#Ambig2',
      'cs:Workflows/Main.cs#Main',
      'cs:Workflows/SubFlow.cs#SubFlow',
      'xaml:Legacy/Old.xaml',
      'cs:Helpers/MathHelper.cs#MathHelper',
      `unresolved:${DYNAMIC_WORKFLOW_NAME}`,
      'unresolved:Missing',
      'unresolved:Shared'
    ]);

    const main = 'cs:Workflows/Main.cs#Main';
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: `${main}->cs:Helpers/MathHelper.cs#MathHelper:call-helper`,
        resolved: true
      }),
      expect.objectContaining({
        id: `${main}->cs:Workflows/SubFlow.cs#SubFlow:invoke-workflow`,
        resolved: true
      }),
      expect.objectContaining({
        id: `${main}->unresolved:${DYNAMIC_WORKFLOW_NAME}:run-xaml`,
        resolved: false,
        unresolvedReason: 'dynamic-argument'
      }),
      expect.objectContaining({
        id: `${main}->unresolved:Missing:invoke-workflow`,
        resolved: false,
        unresolvedReason: 'no-match'
      }),
      expect.objectContaining({
        id: `${main}->unresolved:Shared:invoke-workflow`,
        resolved: false,
        unresolvedReason: 'no-match'
      }),
      expect.objectContaining({
        id: `${main}->xaml:Legacy/Old.xaml:run-xaml`,
        resolved: true
      })
    ]);

    // Only the project.json entry point is badged.
    expect(graph.nodes.filter((n) => n.isEntryPoint).map((n) => n.id)).toEqual([main]);
    // The xaml node carries a clickable uri because the file exists.
    expect(graph.nodes.find((n) => n.id === 'xaml:Legacy/Old.xaml')?.uri).toBe(
      'file:///c:/proj/Legacy/Old.xaml'
    );
  });
});
