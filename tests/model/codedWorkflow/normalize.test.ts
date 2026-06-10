/**
 * Tests for `normalizeStatement` — the bucket-signature generator used by the
 * M0 corpus analysis to group UNMATCHED statements.
 *
 * Includes every required example mapping from the task spec plus coverage
 * for chains with multiple arg-bearing links, the 4-shape cap, `this`
 * receivers, `?.` collapse, depth-limit collapse, and the `svc:`/`handle:`
 * sanity markers.
 */
import { describe, it, expect } from 'vitest';
import { normalizeStatement } from '../../../src/model/codedWorkflow/normalizeStatement';
import type { HandleMap } from '../../../src/model/codedWorkflow/classify/handleTracking';
import { parseStatement } from './snippets';

async function normalize(body: string, handles: HandleMap = {}): Promise<string> {
  const { source, stmt } = await parseStatement(body);
  return normalizeStatement(stmt, source, handles);
}

describe('normalizeStatement — required example mappings', () => {
  it('decl from PascalCase static call: var text = File.ReadAllText(path);', async () => {
    expect(await normalize('var text = File.ReadAllText(path);')).toBe(
      'decl=File.ReadAllText(var)'
    );
  });

  it('compound assign with binop RHS: row += value.ToString() + " ";', async () => {
    expect(await normalize('row += value.ToString() + " ";')).toBe(
      'assign+= binop:+(var.ToString(),str)'
    );
  });

  it('bare call with interpolated string: Console.WriteLine($"x {i}");', async () => {
    expect(await normalize('Console.WriteLine($"x {i}");')).toBe(
      'call:Console.WriteLine(interp)'
    );
  });

  it('return with method chain: return items.Where(i => i.Ok).ToList();', async () => {
    expect(await normalize('return items.Where(i => i.Ok).ToList();')).toBe(
      'return var.Where.ToList(lambda)'
    );
  });

  it('throw with object creation: throw new BusinessRuleException("x");', async () => {
    expect(await normalize('throw new BusinessRuleException("x");')).toBe(
      'throw new:BusinessRuleException(str)'
    );
  });

  it('property segments stay in the dotted path: dt.Rows.Add(arr);', async () => {
    expect(await normalize('dt.Rows.Add(arr);')).toBe('call:var.Rows.Add(var)');
  });

  it('decl from binop: var x = a + b;', async () => {
    expect(await normalize('var x = a + b;')).toBe('decl=binop:+(var,var)');
  });
});

describe('normalizeStatement — chains', () => {
  it('multiple arg-bearing links produce ;-separated groups in chain order', async () => {
    expect(
      await normalize('var q = items.Where(i => i.Ok).Select(i => i.Id).ToList();')
    ).toBe('decl=var.Where.Select.ToList(lambda;lambda)');
  });

  it('caps total arg shapes at 4 and appends +', async () => {
    expect(await normalize('Foo(1, 2, 3, 4, 5);')).toBe(
      'call:Foo(num,num,num,num+)'
    );
  });

  it('bare local helper call keeps its name verbatim', async () => {
    expect(await normalize('DoLocalThing(item, true);')).toBe(
      'call:DoLocalThing(var,bool)'
    );
  });

  it('this receiver renders as this', async () => {
    expect(await normalize('this.Cleanup();')).toBe('call:this.Cleanup()');
  });

  it('?. collapses to a plain chain segment', async () => {
    expect(await normalize('var z = list?.First();')).toBe('decl=var.First()');
  });

  it('predefined-type receiver kept verbatim: string.Join', async () => {
    expect(await normalize('var s = string.Join(",", parts);')).toBe(
      'decl=string.Join(str,var)'
    );
  });

  it('element access is transparent inside a chain', async () => {
    expect(await normalize('var c = rows[0].ToString();')).toBe(
      'decl=var.ToString()'
    );
  });

  it('await unwraps before chain rendering', async () => {
    expect(await normalize('await client.SendAsync(req);')).toBe(
      'call:var.SendAsync(var)'
    );
  });
});

describe('normalizeStatement — receivers and markers', () => {
  it('catalog family receiver renders the svc: sanity marker', async () => {
    expect(await normalize('system.Custom(1);')).toBe(
      'call:svc:system.Custom(num)'
    );
  });

  it('tracked handle receiver renders the handle:<family> marker', async () => {
    expect(await normalize('wb.CleanUp();', { wb: 'excel' })).toBe(
      'call:handle:excel.CleanUp()'
    );
  });
});

describe('normalizeStatement — expression values', () => {
  it('plain assignment with literal: x = 5;', async () => {
    expect(await normalize('x = 5;')).toBe('assign= num');
  });

  it('property read: var v = obj.Prop;', async () => {
    expect(await normalize('var v = obj.Prop;')).toBe('decl=prop:var.Prop');
  });

  it('nested property path keeps segments: var v = dt.Rows.Count;', async () => {
    expect(await normalize('var v = dt.Rows.Count;')).toBe(
      'decl=prop:var.Rows.Count'
    );
  });

  it('index read: var w = arr[0];', async () => {
    expect(await normalize('var w = arr[0];')).toBe('decl=index:var');
  });

  it('ternary: var t = flag ? 1 : 2;', async () => {
    expect(await normalize('var t = flag ? 1 : 2;')).toBe('decl=ternary');
  });

  it('object creation with generic type keeps the type verbatim (whitespace stripped)', async () => {
    expect(await normalize('var n = new Dictionary<string, int>();')).toBe(
      'decl=new:Dictionary<string,int>()'
    );
  });

  it('binop nesting beyond depth 2 collapses to expr', async () => {
    expect(await normalize('var d = (((a + b) + c) + d) + e;')).toBe(
      'decl=binop:+(binop:+(binop:+(expr,var),var),var)'
    );
  });
});

describe('normalizeStatement — statement heads', () => {
  it('yield return renders the yield head', async () => {
    expect(await normalize('yield return x;')).toBe('yield var');
  });

  it('bare return renders return with no value', async () => {
    expect(await normalize('return;')).toBe('return');
  });

  it('unknown statement kinds fall back to stmt:<type>', async () => {
    expect(await normalize('if (flag) { x = 1; }')).toBe('stmt:if_statement');
  });
});
