/**
 * Bundled-runtime smoke for the C# parser.
 *
 * Bundles scripts/_parserSmokeEntry.ts with the REAL extension `hostConfig`
 * (imported from esbuild.mjs), so web-tree-sitter is resolved and bundled
 * exactly as it is for dist/extension.js, then runs the bundle under Node.
 *
 * This is the guard for the `import.meta.url` / `createRequire(undefined)`
 * bundling hazard: every vitest test loads web-tree-sitter UNBUNDLED from
 * node_modules and therefore cannot see it. Run it after any change to the
 * host build or the web-tree-sitter dependency.
 *
 *   node scripts/bundleSmoke.mjs            # build WITH the host shim → must pass
 *   node scripts/bundleSmoke.mjs --no-shim  # strip the shim → reproduces the bug
 */
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { hostConfig, copyWasm } from '../esbuild.mjs';

const withShim = !process.argv.includes('--no-shim');
const outfile = '.smoke/parserSmoke.cjs';

const config = {
  ...hostConfig,
  entryPoints: ['scripts/_parserSmokeEntry.ts'],
  outfile,
  // Match the SHIPPED bundle: minified, so this also guards that the
  // import.meta.url shim (a banner-declared const) survives minification.
  minify: true,
  sourcemap: false
};
if (!withShim) {
  delete config.define;
  delete config.banner;
  console.log('[smoke] building WITHOUT the import.meta.url shim (repro mode)');
}

await copyWasm(); // the smoke loads dist/*.wasm
await esbuild.build(config);

try {
  const out = execFileSync(process.execPath, [outfile], { encoding: 'utf8' });
  process.stdout.write(out);
  if (withShim) {
    console.log('[smoke] PASS — the bundled parser initialised and parsed.');
  } else {
    console.error('[smoke] UNEXPECTED: passed without the shim.');
    process.exit(1);
  }
} catch (err) {
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  console.error(`[smoke] bundle exited non-zero (${err.status}).`);
  // Without the shim a non-zero exit is the EXPECTED reproduction; with it,
  // it's a real failure. Either way surface a non-zero status for CI.
  process.exit(1);
}
