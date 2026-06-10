/**
 * Stage-A tests: the buildModel body walk emits `CwContainer` nodes with
 * child slots (recursive classification), hierarchical stable ids, exact
 * headers capped at HEADER_MAX_CHARS, and one-chip local functions.
 *
 * Fixture: tests/fixtures/codedWorkflow/skeleton/containers-nesting.cs —
 * every CwContainerKind, an else-if chain, a block-less body, a >=4-level
 * nesting path, and an over-80-char if condition.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  configureCSharpParserFromNodeModules,
  loadFixture,
  sliceBySpan
} from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';
import { HEADER_MAX_CHARS } from '../../../src/model/codedWorkflow/limits';
import type {
  CodedWorkflowModel,
  CwContainer,
  CwRawChip,
  CwStatement
} from '../../../src/model/codedWorkflow/cwTypes';

const SOURCE = loadFixture('skeleton/containers-nesting.cs');

let model: CodedWorkflowModel;

beforeAll(async () => {
  configureCSharpParserFromNodeModules();
  const parser = await getCSharpParser();
  const tree = parser.parse(SOURCE);
  try {
    model = buildModel(tree, SOURCE, {
      fileName: 'containers-nesting.cs',
      fileUri: 'file:///fixtures/containers-nesting.cs'
    });
  } finally {
    tree.delete();
  }
});

function executeBody(): CwStatement[] {
  return model.classes[0].entryPoints[0].body;
}

function asContainer(stmt: CwStatement): CwContainer {
  expect(stmt.type).toBe('container');
  return stmt as CwContainer;
}

function asChip(stmt: CwStatement): CwRawChip {
  expect(stmt.type).toBe('raw');
  return stmt as CwRawChip;
}

/** Collect every raw chip in a statement tree, depth-first. */
function collectChips(children: CwStatement[]): CwRawChip[] {
  const out: CwRawChip[] = [];
  for (const child of children) {
    if (child.type === 'raw') out.push(child);
    if (child.type === 'container') {
      for (const slot of child.slots) out.push(...collectChips(slot.children));
    }
  }
  return out;
}

describe('containers — top-level structure', () => {
  it('parses the fixture cleanly', () => {
    expect(model.parseHealth).toBe('ok');
    expect(model.classes).toHaveLength(1);
  });

  it('emits the Execute body as chips and containers in source order', () => {
    const kinds = executeBody().map((s) =>
      s.type === 'container' ? (s as CwContainer).kind : s.type
    );
    expect(kinds).toEqual([
      'raw', // var seed = 0;
      'if',
      'for',
      'do',
      'try',
      'switch',
      'using',
      'if', // block-less
      'if', // long header
      'raw' // local function chip
    ]);
  });

  it('assigns hierarchical top-level ids <entryName>/<index>', () => {
    expect(executeBody().map((s) => s.id)).toEqual([
      'Execute/0',
      'Execute/1',
      'Execute/2',
      'Execute/3',
      'Execute/4',
      'Execute/5',
      'Execute/6',
      'Execute/7',
      'Execute/8',
      'Execute/9'
    ]);
  });
});

describe('containers — if / else-if / else flattening', () => {
  it('flattens the else-if chain into sibling slots with exact labels', () => {
    const ifC = asContainer(executeBody()[1]);
    expect(ifC.kind).toBe('if');
    expect(ifC.header).toBe('If name.Length > 0');
    expect(ifC.slots.map((s) => s.role)).toEqual(['then', 'elseif', 'elseif', 'else']);
    expect(ifC.slots.map((s) => s.label)).toEqual([
      'Then',
      'Else If mode == 1',
      'Else If mode == 2',
      'Else'
    ]);
  });

  it('numbers repeated slot roles in child ids (elseif0, elseif1)', () => {
    const ifC = asContainer(executeBody()[1]);
    expect(ifC.slots[1].children.map((s) => s.id)).toEqual(['Execute/1.elseif0.0']);
    expect(ifC.slots[2].children.map((s) => s.id)).toEqual(['Execute/1.elseif1.0']);
    expect(ifC.slots[3].children.map((s) => s.id)).toEqual(['Execute/1.else.0']);
  });

  it('classifies >=4-level nesting with stable ids and exact spans', () => {
    const ifC = asContainer(executeBody()[1]);
    const then = ifC.slots[0];
    expect(then.children.map((s) => s.id)).toEqual([
      'Execute/1.then.0',
      'Execute/1.then.1'
    ]);

    const foreach = asContainer(then.children[1]);
    expect(foreach.kind).toBe('foreach');
    expect(foreach.header).toBe('For Each c in name');

    const whileC = asContainer(foreach.slots[0].children[0]);
    expect(whileC.kind).toBe('while');
    expect(whileC.header).toBe('While mode > 0');
    expect(whileC.id).toBe('Execute/1.then.1.body.0');

    const innerIf = asContainer(whileC.slots[0].children[0]);
    expect(innerIf.kind).toBe('if');
    expect(innerIf.header).toBe("If c == 'x'");
    expect(innerIf.id).toBe('Execute/1.then.1.body.0.body.0');

    const deepChip = asChip(innerIf.slots[0].children[0]);
    expect(deepChip.id).toBe('Execute/1.then.1.body.0.body.0.then.0');
    expect(deepChip.code).toBe('deep = deep + 1;');
    expect(sliceBySpan(SOURCE, deepChip.span)).toBe(deepChip.code);

    const afterIf = asChip(whileC.slots[0].children[1]);
    expect(afterIf.id).toBe('Execute/1.then.1.body.0.body.1');
    expect(afterIf.code).toBe('mode = mode - 1;');
  });
});

describe('containers — loop headers', () => {
  it('renders for / do headers from exact source slices', () => {
    const forC = asContainer(executeBody()[2]);
    expect(forC.kind).toBe('for');
    expect(forC.header).toBe('For var i = 0; i < mode; i++');
    expect(forC.slots.map((s) => s.role)).toEqual(['body']);

    const doC = asContainer(executeBody()[3]);
    expect(doC.kind).toBe('do');
    expect(doC.header).toBe('Do … While mode < 0');
    expect(asChip(doC.slots[0].children[0]).code).toBe('mode = mode + 1;');
  });
});

describe('containers — try / catch / finally', () => {
  it('emits one catch slot per clause with declaration-derived labels', () => {
    const tryC = asContainer(executeBody()[4]);
    expect(tryC.kind).toBe('try');
    expect(tryC.header).toBe('Try / Catch');
    expect(tryC.slots.map((s) => s.role)).toEqual(['try', 'catch', 'catch', 'finally']);
    expect(tryC.slots.map((s) => s.label)).toEqual([
      'Try',
      'Catch IOException ex',
      'Catch',
      'Finally'
    ]);
    expect(tryC.slots[1].children.map((s) => s.id)).toEqual(['Execute/4.catch0.0']);
    expect(tryC.slots[2].children.map((s) => s.id)).toEqual(['Execute/4.catch1.0']);
  });
});

describe('containers — switch', () => {
  it('emits one case slot per switch_section, default last', () => {
    const switchC = asContainer(executeBody()[5]);
    expect(switchC.kind).toBe('switch');
    expect(switchC.header).toBe('Switch mode');
    expect(switchC.slots.map((s) => s.role)).toEqual(['case', 'case', 'case', 'default']);
    expect(switchC.slots.map((s) => s.label)).toEqual([
      'Case 1',
      'Case 2',
      'Case 3',
      'Default'
    ]);
    // Stacked labels (`case 2: case 3:`) are separate grammar sections — the
    // first one is honestly empty.
    expect(switchC.slots[1].children).toEqual([]);
    expect(asChip(switchC.slots[2].children[0]).code).toBe('throw new Exception("boom");');
    expect(switchC.slots[2].children[0].id).toBe('Execute/5.case2.0');
    expect(switchC.slots[3].children[0].id).toBe('Execute/5.default.0');
  });
});

describe('containers — using', () => {
  it('renders the resource in the header and a single body slot', () => {
    const usingC = asContainer(executeBody()[6]);
    expect(usingC.kind).toBe('using');
    expect(usingC.header).toBe('Use var file = OpenFile(name)');
    expect(usingC.slots.map((s) => s.role)).toEqual(['body']);
    expect(asChip(usingC.slots[0].children[0]).code).toBe('touched = touched + 1;');
    // OpenFile is not a tier-1 service call — no resource card.
    expect(usingC.resourceCard).toBeUndefined();
  });
});

describe('containers — block-less bodies, header caps, local functions', () => {
  it('wraps a block-less consequence in a slot with one classified child', () => {
    const ifC = asContainer(executeBody()[7]);
    expect(ifC.header).toBe('If mode > 9');
    expect(ifC.slots).toHaveLength(1);
    const chip = asChip(ifC.slots[0].children[0]);
    expect(chip.code).toBe('seed = 99;');
    // Block-less slot span === the single statement's span.
    expect(ifC.slots[0].span).toEqual(chip.span);
  });

  it('caps headers at HEADER_MAX_CHARS with a trailing ellipsis', () => {
    const longIf = asContainer(executeBody()[8]);
    expect(longIf.header.length).toBe(HEADER_MAX_CHARS + 1);
    expect(longIf.header.startsWith('If name.Contains("alpha")')).toBe(true);
    expect(longIf.header.endsWith('…')).toBe(true);
  });

  it('classifies a local function as ONE chip without recursing', () => {
    const chip = asChip(executeBody()[9]);
    expect(chip.code.startsWith('int Local(int v)')).toBe(true);
    expect(chip.code.endsWith('}')).toBe(true);
    expect(chip.statementCount).toBe(1);
  });
});

describe('containers — span/code invariants and stats', () => {
  it('every chip code re-slices exactly from its span', () => {
    for (const chip of collectChips(executeBody())) {
      expect(sliceBySpan(SOURCE, chip.span)).toBe(chip.code);
    }
  });

  it('container spans cover their full statement source', () => {
    const tryC = asContainer(executeBody()[4]);
    expect(sliceBySpan(SOURCE, tryC.span).startsWith('try')).toBe(true);
    expect(sliceBySpan(SOURCE, tryC.span).endsWith('}')).toBe(true);
    const slotSlice = sliceBySpan(SOURCE, tryC.slots[0].span);
    expect(slotSlice.startsWith('{')).toBe(true);
    expect(slotSlice.endsWith('}')).toBe(true);
  });

  it('counts leaves (not containers) in tierCounts and stats', () => {
    const execute = model.classes[0].entryPoints[0];
    const chipStatements = collectChips(execute.body).reduce(
      (sum, c) => sum + c.statementCount,
      0
    );
    expect(execute.tierCounts.tier3).toBe(chipStatements);
    expect(execute.tierCounts.tier1).toBe(0);
    // Helper methods: Process (1 chip) + OpenFile (1 chip).
    expect(model.stats.totalStatements).toBe(chipStatements + 2);
    expect(model.truncated).toBe(false);
  });

  it('containers default to expanded on a small fixture', () => {
    const containers = executeBody().filter((s) => s.type === 'container');
    for (const c of containers) {
      expect((c as CwContainer).collapsedByDefault).toBe(false);
    }
  });
});
