/**
 * Entry point for scripts/bundleSmoke.mjs.
 *
 * Exercises the C# parser (configure → init wasm → parse) so it can be BUNDLED
 * with the real extension `hostConfig` and run under Node — catching the
 * web-tree-sitter `import.meta.url`/`createRequire` bundling hazard that unit
 * tests cannot, because vitest loads web-tree-sitter unbundled from
 * node_modules. Not shipped (scripts/** is in .vscodeignore).
 */
import { join } from 'node:path';
import {
  configureCSharpParser,
  getCSharpParser,
  disposeCSharpParser
} from '../src/model/codedWorkflow/parser';

async function main(): Promise<void> {
  const distDir = join(process.cwd(), 'dist');
  configureCSharpParser({
    runtimeWasmPath: join(distDir, 'web-tree-sitter.wasm'),
    grammarWasmPath: join(distDir, 'tree-sitter-c_sharp.wasm')
  });

  const parser = await getCSharpParser();
  const tree = parser.parse(
    'class A : CodedWorkflow { [Workflow] public void Execute() { Log("hi"); } }'
  );
  const root = tree.rootNode;
  const ok = root.type === 'compilation_unit' && !root.hasError;
  console.log(
    `root=${root.type} hasError=${root.hasError} namedChildren=${root.namedChildCount}`
  );
  tree.delete();
  disposeCSharpParser();

  if (!ok) {
    console.error('BUNDLE SMOKE FAIL: unexpected parse result');
    process.exit(1);
  }
  console.log('BUNDLE SMOKE OK');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`BUNDLE SMOKE FAIL: ${message}`);
  process.exit(1);
});
