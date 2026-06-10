/**
 * Tests for the tier-1 matcher (`tier1Match.ts`), method-local handle
 * tracking (`handleTracking.ts`), and seed-catalog integrity
 * (`tier1Catalog.ts`).
 */
import { describe, it, expect } from 'vitest';
import { matchTier1 } from '../../../src/model/codedWorkflow/classify/tier1Match';
import {
  createHandleMap,
  trackHandle
} from '../../../src/model/codedWorkflow/classify/handleTracking';
import type { HandleMap } from '../../../src/model/codedWorkflow/classify/handleTracking';
import {
  TIER1_CATALOG,
  BASE_FAMILY_ID
} from '../../../src/model/codedWorkflow/classify/tier1Catalog';
import { parseStatement, parseWorkflowBody } from './snippets';

async function match(body: string, handles: HandleMap = {}) {
  const { stmt } = await parseStatement(body);
  return matchTier1(stmt, handles);
}

describe('matchTier1 — catalog hits', () => {
  it('matches a cataloged service call with result binding', async () => {
    const m = await match('var asset = system.GetAsset("k");');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('system');
    expect(m!.familyDisplayName).toBe('System');
    expect(m!.method).toBe('GetAsset');
    expect(m!.catalogEntry).toBeDefined();
    expect(m!.catalogEntry!.title).toBe('Get Asset');
    expect(m!.resultBinding).toBe('asset');
  });

  it('matches an unknown member of a known family WITHOUT a catalog entry', async () => {
    const m = await match('system.WhateverNew(1);');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('system');
    expect(m!.method).toBe('WhateverNew');
    expect(m!.catalogEntry).toBeUndefined();
    expect(m!.resultBinding).toBeUndefined();
  });

  it('matches a wildcard family call (workflows) without an entry', async () => {
    const m = await match('workflows.ProcessInvoice(data);');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('workflows');
    expect(m!.familyDisplayName).toBe('Workflows');
    expect(m!.method).toBe('ProcessInvoice');
    expect(m!.catalogEntry).toBeUndefined();
  });

  it('captures the binding of a plain assignment', async () => {
    const m = await match('x = system.GetCredential("c");');
    expect(m).not.toBeNull();
    expect(m!.method).toBe('GetCredential');
    expect(m!.catalogEntry).toBeDefined();
    expect(m!.resultBinding).toBe('x');
  });

  it('unwraps await and matches the inner invocation', async () => {
    const m = await match('var r = await system.GetAssetAsync("k");');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('system');
    expect(m!.method).toBe('GetAssetAsync');
    expect(m!.catalogEntry).toBeUndefined();
    expect(m!.resultBinding).toBe('r');
  });

  it('skips a leading this. before the service root', async () => {
    const m = await match('this.system.GetAsset("k");');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('system');
    expect(m!.method).toBe('GetAsset');
  });

  it('matches a return of a service call without a binding', async () => {
    const m = await match('return system.GetAsset("k");');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('system');
    expect(m!.resultBinding).toBeUndefined();
  });
});

describe('matchTier1 — base-class bare calls', () => {
  it('matches bare Log(...) to the _base family', async () => {
    const m = await match('Log("x");');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe(BASE_FAMILY_ID);
    expect(m!.familyDisplayName).toBe('Workflow');
    expect(m!.method).toBe('Log');
    expect(m!.catalogEntry).toBeDefined();
    expect(m!.catalogEntry!.args[0].label).toBe('Message');
  });

  it('matches bare RunWorkflow(...)', async () => {
    const m = await match('RunWorkflow("Sub", args);');
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe(BASE_FAMILY_ID);
    expect(m!.method).toBe('RunWorkflow');
    expect(m!.catalogEntry).toBeDefined();
  });

  it('rejects a bare local helper call not in the _base catalog', async () => {
    expect(await match('DoLocalThing();')).toBeNull();
  });
});

describe('matchTier1 — rejections', () => {
  it('rejects calls on unknown receivers (helper.DoThing())', async () => {
    expect(await match('helper.DoThing();')).toBeNull();
  });

  it('rejects BCL static calls (Console.WriteLine)', async () => {
    expect(await match('Console.WriteLine("x");')).toBeNull();
  });

  it('rejects non-invocation statements', async () => {
    expect(await match('var x = a + b;')).toBeNull();
  });
});

describe('handle tracking — service handles flow through locals', () => {
  it('tracks a using-statement handle and matches through element access', async () => {
    const { statements } = await parseWorkflowBody(
      'using (var wb = excel.UseExcelFile("a.xlsx")) { wb.Sheet["S1"].ReadRange(); }'
    );
    const usingStmt = statements[0];
    const handles = createHandleMap();
    trackHandle(handles, usingStmt);
    expect(handles).toEqual({ wb: 'excel' });

    const inner = usingStmt
      .childForFieldName('body')!
      .namedChildren.find((n) => n.type === 'expression_statement')!;
    const m = matchTier1(inner, handles);
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('excel');
    expect(m!.familyDisplayName).toBe('Excel');
    expect(m!.method).toBe('ReadRange');
    expect(m!.catalogEntry).toBeUndefined();
  });

  it('tracks a plain local declaration handle', async () => {
    const { statements } = await parseWorkflowBody(
      'var app = uiAutomation.Open(target); app.Click();'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    expect(handles).toEqual({ app: 'uiAutomation' });

    const m = matchTier1(statements[1], handles);
    expect(m).not.toBeNull();
    expect(m!.familyId).toBe('uiAutomation');
    expect(m!.method).toBe('Click');
  });

  it('tracks a using-declaration (no parens) handle', async () => {
    const { statements } = await parseWorkflowBody(
      'using var wb = excel.UseExcelFile("b.xlsx"); wb.Save();'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    expect(handles).toEqual({ wb: 'excel' });
    expect(matchTier1(statements[1], handles)!.familyId).toBe('excel');
  });

  it('reassignment from a non-service expression kills the handle', async () => {
    const { statements } = await parseWorkflowBody(
      'var wb = excel.UseExcelFile("a.xlsx"); wb = null; wb.ReadRange();'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    expect(matchTier1(statements[2], handles)).not.toBeNull();

    trackHandle(handles, statements[1]);
    expect(handles).toEqual({});
    expect(matchTier1(statements[2], handles)).toBeNull();
  });

  it('reassignment from another service re-binds the handle', async () => {
    const { statements } = await parseWorkflowBody(
      'var doc = excel.UseExcelFile("a.xlsx"); doc = word.UseWordFile("b.docx");'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    trackHandle(handles, statements[1]);
    expect(handles).toEqual({ doc: 'word' });
  });

  it('a handle-rooted invocation result is itself tracked (handles flow forward)', async () => {
    const { statements } = await parseWorkflowBody(
      'var wb = excel.UseExcelFile("a.xlsx"); var sheet = wb.GetSheet("S1");'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    trackHandle(handles, statements[1]);
    expect(handles).toEqual({ wb: 'excel', sheet: 'excel' });
  });

  it('declarations from non-service expressions do not track', async () => {
    const { statements } = await parseWorkflowBody(
      'var x = File.ReadAllText(path); var y = 5;'
    );
    const handles = createHandleMap();
    trackHandle(handles, statements[0]);
    trackHandle(handles, statements[1]);
    expect(handles).toEqual({});
  });
});

describe('tier-1 catalog integrity', () => {
  it('has unique family ids and includes the _base family', () => {
    const ids = TIER1_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(BASE_FAMILY_ID);
  });

  it('every family has a display name and icon; entries have unique methods', () => {
    for (const family of TIER1_CATALOG) {
      expect(family.displayName.length).toBeGreaterThan(0);
      expect(family.icon.length).toBeGreaterThan(0);
      const methods = family.entries.map((e) => e.method);
      expect(new Set(methods).size).toBe(methods.length);
    }
  });

  it('the workflows family is wildcard-only', () => {
    const wf = TIER1_CATALOG.find((f) => f.id === 'workflows')!;
    expect(wf.entries).toEqual([]);
    expect(wf.wildcardTitleTemplate).toBe('Invoke Workflow {method}');
  });

  it('connections displays as Integration Service', () => {
    const conn = TIER1_CATALOG.find((f) => f.id === 'connections')!;
    expect(conn.displayName).toBe('Integration Service');
  });
});
