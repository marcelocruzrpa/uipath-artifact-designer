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
