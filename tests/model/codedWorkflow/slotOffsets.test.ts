import { it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import { buildModel } from '../../../src/model/codedWorkflow/buildModel';

beforeAll(() => configureCSharpParserFromNodeModules());

async function modelOf(src: string) {
  const tree = (await getCSharpParser()).parse(src);
  try { return buildModel(tree, src, { fileName: 'w.cs', fileUri: 'file:///w.cs' }); }
  finally { tree.delete(); }
}

it('captures the entry-point body interior + per-statement offsets', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Log("a");',
    '    Log("b");',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const ep = model.classes[0].entryPoints[0];
  expect(ep.bodySpan).toBeDefined();
  // The body id-prefix is exactly what assignIds used (no overload here).
  expect(ep.bodyId).toBe('W#Execute/');
  // The two statements sit inside the body interior.
  expect(ep.body[0].offsets).toBeDefined();
  expect(src.slice(ep.body[0].offsets!.start, ep.body[0].offsets!.end)).toBe('Log("a");');
  // The statement id uses the same prefix.
  expect(ep.body[0].id.startsWith(ep.bodyId!)).toBe(true);
  // Inferred indentation is the 4-space leading whitespace.
  expect(ep.indentText).toBe('    ');
});

it('captures a slot body interior for an if/then', async () => {
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    if (x) {',
    '      Log("t");',
    '    }',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const container = model.classes[0].entryPoints[0].body[0];
  if (container.type !== 'container') throw new Error('expected container');
  const then = container.slots[0];
  expect(then.bodySpan).toBeDefined();
  expect(then.indentText).toBe('      ');
});

it('carries offsets onto a MERGED raw chip (Fence F: chips delete/move as a unit)', async () => {
  // Two adjacent unrecognized bare calls → two raw chips that merge into one.
  const src = [
    'class W : CodedWorkflow {',
    '  [Workflow] public void Execute() {',
    '    Foo();',
    '    Bar();',
    '  }',
    '}'
  ].join('\n');
  const model = await modelOf(src);
  const body = model.classes[0].entryPoints[0].body;
  expect(body).toHaveLength(1);            // the two chips merged
  expect(body[0].type).toBe('raw');
  // The merged chip's offsets span Foo();…Bar(); so a delete removes both lines.
  expect(body[0].offsets).toBeDefined();
  expect(src.slice(body[0].offsets!.start, body[0].offsets!.end)).toBe('Foo();\n    Bar();');
});
