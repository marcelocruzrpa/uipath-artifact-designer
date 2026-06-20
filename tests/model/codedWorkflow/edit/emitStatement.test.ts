import { it, expect } from 'vitest';
import { emitStatement } from '../../../../src/model/codedWorkflow/edit/emitStatement';
import { findPaletteItem } from '../../../../src/model/codedWorkflow/edit/editCatalog';

it('emits a base Log call with an auto-quoted string arg', () => {
  const item = findPaletteItem('catalog:_base.Log')!;
  expect(emitStatement(item, ['hello'])).toBe('Log("hello");');
});

it('emits a system call with the receiver and a quoted string', () => {
  const item = findPaletteItem('catalog:system.GetAsset')!;
  expect(emitStatement(item, ['MyAsset'], 'asset')).toBe('var asset = system.GetAsset("MyAsset");');
});

it('emits AddQueueItem with a string + identifier', () => {
  const item = findPaletteItem('catalog:system.AddQueueItem')!;
  expect(emitStatement(item, ['Retries', 'item'])).toBe('system.AddQueueItem("Retries", item);');
});

it('emits an Assign', () => {
  const item = findPaletteItem('step:assign')!;
  expect(emitStatement(item, ['count', '0'])).toBe('var count = 0;');
});

it('emits an Add item', () => {
  const item = findPaletteItem('step:add-item')!;
  expect(emitStatement(item, ['rows', 'row'])).toBe('rows.Add(row);');
});

it('passes raw code through, adding a trailing semicolon when missing', () => {
  const item = findPaletteItem('raw')!;
  expect(emitStatement(item, [], undefined, 'DoThing(x)')).toBe('DoThing(x);');
  expect(emitStatement(item, [], undefined, 'DoThing(x);')).toBe('DoThing(x);');
});

it('does not append a semicolon to raw text that should not have one', () => {
  const item = findPaletteItem('raw')!;
  // A block opener / closer / block-comment close / line comment must NOT gain
  // a stray `;` (`if (x) {;` and `// note;` are wrong / change meaning).
  expect(emitStatement(item, [], undefined, 'if (x) {')).toBe('if (x) {');
  expect(emitStatement(item, [], undefined, '}')).toBe('}');
  expect(emitStatement(item, [], undefined, '/* block */')).toBe('/* block */');
  expect(emitStatement(item, [], undefined, '// note')).toBe('// note');
});

it('does not double-quote a string value that is already a literal', () => {
  const item = findPaletteItem('catalog:_base.Log')!;
  // A user who types an explicit quoted literal keeps it (still one literal).
  expect(emitStatement(item, ['"hi"'])).toBe('Log("hi");');
});
