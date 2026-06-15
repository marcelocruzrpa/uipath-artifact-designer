import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from '../helpers';
import { getCSharpParser } from '../../../../src/model/codedWorkflow/parser';
import { introducesNewError } from '../../../../src/model/codedWorkflow/edit/parseGate';

beforeAll(() => configureCSharpParserFromNodeModules());
const wrap = (s: string) => `class W : CodedWorkflow { [Workflow] public void Execute() { ${s} } }`;

it('accepts a well-formed edit', async () => {
  const parser = await getCSharpParser();
  expect(introducesNewError(parser, wrap('Log("hi");'), wrap('Log("bye");'))).toBe(false);
});

it('rejects an edit that breaks the syntax', async () => {
  const parser = await getCSharpParser();
  expect(introducesNewError(parser, wrap('Log("hi");'), wrap('Log("bye);'))).toBe(true);
});

// Count-based hardening: `rootNode.hasError` is a boolean, so the old gate could
// never block a NEW error when the file was ALREADY broken (it returned false
// for every edit to a broken file). The gate now counts ERROR+MISSING nodes
// before and after and rejects only when the count GREW.
it('rejects an edit that ADDS an error to an already-broken file', async () => {
  const parser = await getCSharpParser();
  // before has one unterminated call (1 error); after adds a SECOND one (2).
  const before = 'class W { void E() { Log("hi"; } }';
  const after = 'class W { void E() { Log("hi"; Foo("x"; } }';
  expect(introducesNewError(parser, before, after)).toBe(true);
});

it('still ALLOWS a benign edit to an already-broken file (error count unchanged)', async () => {
  const parser = await getCSharpParser();
  // both have exactly one error (the unterminated call); the edit only renames
  // the string content, so the count does not grow — the gate must allow it.
  const before = 'class W { void E() { Log("hi"; } }';
  const after = 'class W { void E() { Log("bye"; } }';
  expect(introducesNewError(parser, before, after)).toBe(false);
});
