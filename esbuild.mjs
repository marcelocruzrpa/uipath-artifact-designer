import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Copy tree-sitter wasm files flat into dist/ so the extension host can load
 *  them at runtime via an absolute fsPath.  Called once at the top of run()
 *  — the files don't change between watch rebuilds. */
export async function copyWasm() {
  await mkdir('dist', { recursive: true });
  await Promise.all([
    copyFile(
      'node_modules/web-tree-sitter/web-tree-sitter.wasm',
      'dist/web-tree-sitter.wasm'
    ),
    copyFile(
      'node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
      'dist/tree-sitter-c_sharp.wasm'
    )
  ]);
  console.log('[esbuild] wasm files copied to dist/');
}

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  // Sourcemaps are emitted for the production build too: they aid field
  // debugging of the bundled extension and are not surfaced to users via the
  // marketplace listing. Minification stays on for production.
  sourcemap: true,
  logLevel: 'info'
};

/** @type {import('esbuild').BuildOptions} */
export const hostConfig = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  // web-tree-sitter resolves to its ESM build via the `import` condition (our
  // parser.ts uses `import` syntax), and that build runs, under Node,
  // `createRequire(import.meta.url)` + `new URL(..., import.meta.url)`. esbuild
  // rewrites `import.meta` to `{}` in a cjs bundle, so `import.meta.url` is
  // `undefined` and `createRequire(undefined)` throws at parser init (the
  // "filename must be a file URL … Received undefined" error). Shim it to the
  // bundle's own file URL — valid in cjs via __filename, and also the correct
  // value for any other import.meta.url use. Verified by scripts/bundleSmoke.mjs;
  // regressing this breaks the canvas at runtime while every vitest test (which
  // loads web-tree-sitter unbundled) still passes.
  define: { 'import.meta.url': '__cjsImportMetaUrl' },
  banner: {
    js: "const __cjsImportMetaUrl = require('node:url').pathToFileURL(__filename).href;"
  }
};

/** @type {import('esbuild').BuildOptions} */
export const webviewConfig = {
  ...common,
  entryPoints: ['webview/index.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  loader: {
    '.css': 'css',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.eot': 'dataurl',
    '.svg': 'dataurl'
  }
};

export async function run() {
  await copyWasm();
  if (watch) {
    const host = await esbuild.context(hostConfig);
    const web = await esbuild.context(webviewConfig);
    await Promise.all([host.watch(), web.watch()]);
    console.log('[esbuild] watching for changes...');
  } else {
    await Promise.all([esbuild.build(hostConfig), esbuild.build(webviewConfig)]);
    console.log('[esbuild] build complete');
  }
}

// Build only when invoked directly (`node esbuild.mjs [...]`). When imported —
// e.g. by scripts/bundleSmoke.mjs to reuse hostConfig — this stays inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
