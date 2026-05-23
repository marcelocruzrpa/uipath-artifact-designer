import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
const hostConfig = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode']
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
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

async function run() {
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

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
