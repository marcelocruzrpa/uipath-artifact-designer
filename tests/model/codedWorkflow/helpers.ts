/**
 * Test-side helper that wires the C# parser singleton with wasm paths resolved
 * from `node_modules`.  Import this in any test or script that needs a live
 * tree-sitter parser without knowing where the extension will be installed.
 *
 * Node imports are intentionally allowed here — this file never ships in the
 * extension bundle or the webview.
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { configureCSharpParser } from '../../../src/model/codedWorkflow/parser';
import type { SourceSpan } from '../../../src/model/codedWorkflow/cwTypes';

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

/**
 * Read a fixture from `tests/fixtures/codedWorkflow/<relPath>` (forward
 * slashes), normalizing CRLF to LF so spans/line counts are stable regardless
 * of git's `core.autocrlf` setting on the checkout.
 */
export function loadFixture(relPath: string): string {
  const path = join(__dirname, '..', '..', 'fixtures', 'codedWorkflow', ...relPath.split('/'));
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/** Re-slice `source` by a 0-based span — verifies span↔code agreement. */
export function sliceBySpan(source: string, span: SourceSpan): string {
  const lines = source.split('\n');
  if (span.startLine === span.endLine) {
    return lines[span.startLine].slice(span.startCol, span.endCol);
  }
  const parts = [lines[span.startLine].slice(span.startCol)];
  for (let i = span.startLine + 1; i < span.endLine; i += 1) {
    parts.push(lines[i]);
  }
  parts.push(lines[span.endLine].slice(0, span.endCol));
  return parts.join('\n');
}

/** 0-based line of the first source line containing `needle`. */
export function lineOf(source: string, needle: string): number {
  const index = source.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`fixture is missing: ${needle}`);
  return index;
}
