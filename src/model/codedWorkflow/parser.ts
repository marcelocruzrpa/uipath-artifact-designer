/**
 * Lazy singleton wrapper around `web-tree-sitter` for parsing C# coded-workflow
 * source files.
 *
 * PURITY RULE: this module may import ONLY `'web-tree-sitter'`.  No `vscode`,
 * `fs`, `path`, or `node:*` imports are permitted here — the file is consumed
 * by both the extension host (at runtime, with wasm copied to dist/) and by
 * model-level tests (with paths resolved by the test helper).  The caller is
 * responsible for supplying absolute wasm paths via `configureCSharpParser`.
 */
import { Parser, Language, type Tree } from 'web-tree-sitter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Absolute wasm paths that the caller must supply before first use. */
export interface ParserWasmPaths {
  /** Absolute path to web-tree-sitter.wasm (the Emscripten runtime). */
  runtimeWasmPath: string;
  /** Absolute path to tree-sitter-c_sharp.wasm (the grammar). */
  grammarWasmPath: string;
}

/**
 * A handle to the initialised C# parser.  Callers receive this from
 * `getCSharpParser()` and use it for all parse calls.
 */
export interface CSharpParserHandle {
  /**
   * Parse `text` as C# source and return the syntax tree.
   * @throws if the underlying parser returned null (only possible when parsing
   *   was cancelled via the progress callback — should never occur in normal
   *   synchronous usage).
   */
  parse(text: string): Tree;
  /** Release the underlying parser resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _paths: ParserWasmPaths | null = null;
let _pendingInit: Promise<CSharpParserHandle> | null = null;
let _handle: CSharpParserHandle | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store the wasm paths for later use.  Must be called before the first
 * `getCSharpParser()` call.  Pure storage — performs no I/O.
 */
export function configureCSharpParser(paths: ParserWasmPaths): void {
  _paths = paths;
}

/**
 * Return the lazily-initialised C# parser singleton.
 *
 * The first call runs:
 *   1. `Parser.init(...)` — loads the Emscripten runtime wasm.
 *   2. `Language.load(...)` — loads the C# grammar wasm.
 *   3. Creates a `Parser` instance and sets the language.
 *
 * Subsequent calls return the same handle without re-initialising.
 * If initialisation fails, the memoised promise is cleared so the next call
 * can retry (useful if the caller corrects the paths and tries again).
 *
 * @throws if `configureCSharpParser` has not been called first.
 */
export function getCSharpParser(): Promise<CSharpParserHandle> {
  if (_handle !== null) {
    return Promise.resolve(_handle);
  }

  if (_pendingInit !== null) {
    return _pendingInit;
  }

  if (_paths === null) {
    return Promise.reject(
      new Error(
        'getCSharpParser: call configureCSharpParser(paths) before first use'
      )
    );
  }

  const paths = _paths;

  _pendingInit = (async (): Promise<CSharpParserHandle> => {
    try {
      await Parser.init({ locateFile: () => paths.runtimeWasmPath });
      const language = await Language.load(paths.grammarWasmPath);
      const parser = new Parser();
      parser.setLanguage(language);

      const handle: CSharpParserHandle = {
        parse(text: string): Tree {
          const tree = parser.parse(text);
          if (tree === null) {
            throw new Error(
              'CSharpParserHandle.parse: parser returned null ' +
                '(parsing was cancelled)'
            );
          }
          return tree;
        },
        dispose(): void {
          parser.delete();
          _handle = null;
          _pendingInit = null;
        }
      };

      _handle = handle;
      return handle;
    } catch (err) {
      // Reset so a subsequent call can retry after correcting the paths.
      _pendingInit = null;
      throw err;
    }
  })();

  return _pendingInit;
}

/**
 * Dispose the parser if it has been initialised and reset all singleton state.
 * Safe to call at any time, including before initialisation.
 */
export function disposeCSharpParser(): void {
  if (_handle !== null) {
    // Call parser.delete() directly; we cannot call _handle.dispose() because
    // that would set _handle = null mid-flight — instead do the teardown here.
    try {
      _handle.dispose();
    } catch {
      // Ignore errors during teardown.
    }
  }
  _handle = null;
  _pendingInit = null;
}
