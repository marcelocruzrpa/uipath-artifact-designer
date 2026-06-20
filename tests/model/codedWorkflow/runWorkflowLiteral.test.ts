/**
 * Honesty of `RunWorkflow(...)` literal extraction for the two C# 11 string
 * forms the graph-fact extractor was NOT explicitly written for — pins the
 * ACTUAL committed behavior of `graphFacts.stringLiteralValue` so it can never
 * drift silently:
 *
 *   RunWorkflow("""x.xaml""")  — a RAW string literal (node type
 *       `raw_string_literal`).  `stringLiteralValue` only handles
 *       `string_literal` / `verbatim_string_literal`, so a raw string is NOT
 *       decoded → the call is reported as DYNAMIC (`<dynamic workflow>`,
 *       isLiteralArg: false).  This is the honest, conservative outcome: the
 *       edge is kept (R6 never-drop) but not falsely attributed to a target.
 *
 *   RunWorkflow("x.xaml"u8)    — a UTF-8 (`u8`) literal, which the grammar
 *       still types as `string_literal` (with a `string_literal_encoding`
 *       child).  The `string_literal` branch concatenates the
 *       `string_literal_content` and ignores the `u8` suffix, so it decodes to
 *       the literal value `x.xaml` (isLiteralArg: true).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { configureCSharpParserFromNodeModules } from './helpers';
import { getCSharpParser } from '../../../src/model/codedWorkflow/parser';
import {
  DYNAMIC_WORKFLOW_NAME,
  extractFileFacts
} from '../../../src/model/codedWorkflow/graph/graphFacts';

beforeAll(() => configureCSharpParserFromNodeModules());

const wrap = (body: string) =>
  `class W : CodedWorkflow { [Workflow] public void Execute() { ${body} } }`;

async function facts(body: string) {
  const tree = (await getCSharpParser()).parse(wrap(body));
  try {
    return extractFileFacts('Workflows/W.cs', wrap(body), tree);
  } finally {
    tree.delete();
  }
}

describe('RunWorkflow literal extraction — C# 11 string forms', () => {
  it('treats a RAW string literal target as DYNAMIC (not decoded)', async () => {
    const f = await facts('RunWorkflow("""x.xaml""");');
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'run-workflow',
        calleeName: DYNAMIC_WORKFLOW_NAME,
        isLiteralArg: false
      })
    ]);
  });

  it('decodes a u8 UTF-8 literal target to its value', async () => {
    const f = await facts('RunWorkflow("x.xaml"u8);');
    expect(f.invocations).toEqual([
      expect.objectContaining({
        kind: 'run-workflow',
        calleeName: 'x.xaml',
        isLiteralArg: true
      })
    ]);
  });
});
