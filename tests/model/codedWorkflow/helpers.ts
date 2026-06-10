/**
 * Test-side helper that wires the C# parser singleton with wasm paths resolved
 * from `node_modules`.  Import this in any test or script that needs a live
 * tree-sitter parser without knowing where the extension will be installed.
 *
 * Node imports are intentionally allowed here — this file never ships in the
 * extension bundle or the webview.
 */
import { join, dirname } from 'node:path';
import { configureCSharpParser } from '../../../src/model/codedWorkflow/parser';

/**
 * Resolve wasm paths from `node_modules` and configure the parser singleton.
 *
 * - Runtime wasm: resolved via `require.resolve('web-tree-sitter/web-tree-sitter.wasm')`
 *   which is an explicit `exports` map entry in the package.
 * - Grammar wasm: resolved by finding the package root via its `package.json`
 *   (never via `require.resolve('tree-sitter-c-sharp')` which would hit the
 *   native binding entry point and may throw on unsupported platforms).
 */
export function configureCSharpParserFromNodeModules(): void {
  const runtimeWasmPath = require.resolve(
    'web-tree-sitter/web-tree-sitter.wasm'
  );
  const grammarWasmPath = join(
    dirname(require.resolve('tree-sitter-c-sharp/package.json')),
    'tree-sitter-c_sharp.wasm'
  );
  configureCSharpParser({ runtimeWasmPath, grammarWasmPath });
}
