/**
 * M2 perf evidence for the call-graph pipeline (T2.4, G2) — measures the PURE
 * pipeline (parse → extractFileFacts → assembleGraph) in plain Node over
 * generated sample projects.  The host index (`src/artifacts/
 * codedProjectIndex.ts`) is thin stat-cache glue over exactly this pipeline,
 * so these numbers are the honest cold-build cost.  The host's warm path is
 * stat-only and cannot be measured purely; instead we measure the warm
 * INCREMENT: re-parse ONE file + re-assemble from cached facts (what a
 * single-file edit costs).
 *
 * Budgets (G2): cold(50 files) ≤ 1500 ms, increment ≤ 100 ms.
 *
 * Usage (tsx resolves the TypeScript pipeline imports):
 *   npx tsx scripts/graphPerf.mjs [--sizes 50,150]
 *
 * Projects are generated deterministically into tmp-sample-project/perf-<n>
 * (gitignored) and left on disk for inspection.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
  configureCSharpParser,
  getCSharpParser,
  disposeCSharpParser
} from '../src/model/codedWorkflow/parser';
import { extractFileFacts } from '../src/model/codedWorkflow/graph/graphFacts';
import { assembleGraph } from '../src/model/codedWorkflow/graph/assembleGraph';
import { generateProject, ENTRY_REL_PATH } from './genSampleProject.mjs';

const INCREMENT_RUNS = 5;
const COLD_BUDGET_MS_AT_50 = 1500;
const INCREMENT_BUDGET_MS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect `*.cs` files, lexicographically sorted (deterministic). */
function collectCsFiles(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const entry of entries) {
    if (entry.isDirectory()) collectCsFiles(join(dir, entry.name), out);
    else if (entry.isFile() && entry.name.endsWith('.cs')) out.push(join(dir, entry.name));
  }
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function ms(value) {
  return value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Cold-build the graph for the project at `root`, then measure the warm
 * increment (median of INCREMENT_RUNS).  Returns the per-phase timings plus
 * graph shape for sanity checking.
 */
function measureProject(parser, root) {
  const absFiles = [];
  collectCsFiles(root, absFiles);
  const relPaths = absFiles.map((f) => relative(root, f).replace(/\\/g, '/'));

  // --- cold: read -----------------------------------------------------------
  let t = performance.now();
  const sources = absFiles.map((f) => readFileSync(f, 'utf8'));
  const readMs = performance.now() - t;

  // --- cold: parse ----------------------------------------------------------
  t = performance.now();
  const trees = sources.map((s) => parser.parse(s));
  const parseMs = performance.now() - t;

  // --- cold: facts (extraction + tree disposal, like the host loop) ---------
  t = performance.now();
  const facts = relPaths.map((rel, i) => {
    try {
      return {
        ...extractFileFacts(rel, sources[i], trees[i]),
        uri: pathToFileURL(absFiles[i]).href
      };
    } finally {
      trees[i].delete();
    }
  });
  const factsMs = performance.now() - t;

  // --- cold: assemble -------------------------------------------------------
  const projectInfo = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
  const input = {
    projectName: projectInfo.name,
    projectRootUri: pathToFileURL(root).href,
    entryPointRelPaths: new Set(
      (projectInfo.entryPoints ?? []).map((e) => e.filePath.replace(/\\/g, '/'))
    ),
    files: facts,
    xamlFileExists: (normRel) => existsSync(join(root, normRel))
  };
  t = performance.now();
  const graph = assembleGraph(input);
  const assembleMs = performance.now() - t;

  // --- warm increment: re-parse ONE file + re-assemble from cached facts ----
  const entryIdx = relPaths.indexOf(ENTRY_REL_PATH);
  if (entryIdx < 0) throw new Error(`entry file ${ENTRY_REL_PATH} not found under ${root}`);
  const incrementSamples = [];
  for (let run = 0; run < INCREMENT_RUNS; run += 1) {
    t = performance.now();
    const source = readFileSync(absFiles[entryIdx], 'utf8');
    const tree = parser.parse(source);
    let oneFacts;
    try {
      oneFacts = {
        ...extractFileFacts(relPaths[entryIdx], source, tree),
        uri: pathToFileURL(absFiles[entryIdx]).href
      };
    } finally {
      tree.delete();
    }
    const nextFacts = facts.slice();
    nextFacts[entryIdx] = oneFacts;
    assembleGraph({ ...input, files: nextFacts });
    incrementSamples.push(performance.now() - t);
  }

  return {
    files: absFiles.length,
    readMs,
    parseMs,
    factsMs,
    assembleMs,
    coldMs: readMs + parseMs + factsMs + assembleMs,
    incrementMs: median(incrementSamples),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    truncated: graph.truncated,
    nodeKinds: graph.nodes.reduce((acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
      return acc;
    }, {})
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseSizes(argv) {
  const flagIdx = argv.indexOf('--sizes');
  if (flagIdx < 0) return [50, 150];
  const value = argv[flagIdx + 1];
  if (value === undefined) throw new Error('--sizes needs a value, e.g. --sizes 50,150');
  return value.split(',').map((s) => {
    const n = Number.parseInt(s.trim(), 10);
    if (!Number.isInteger(n) || n < 1) throw new Error(`bad size: ${s}`);
    return n;
  });
}

async function main() {
  const sizes = parseSizes(process.argv.slice(2));

  // Same wasm resolution as scripts/corpusSpike.ts / the test helper.
  const nodeRequire = createRequire(import.meta.url);
  configureCSharpParser({
    runtimeWasmPath: nodeRequire.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    grammarWasmPath: join(
      dirname(nodeRequire.resolve('tree-sitter-c-sharp/package.json')),
      'tree-sitter-c_sharp.wasm'
    )
  });
  let t = performance.now();
  const parser = await getCSharpParser();
  const initMs = performance.now() - t;

  const results = [];
  for (const n of sizes) {
    const root = resolve('tmp-sample-project', `perf-${n}`);
    generateProject(n, root);
    results.push({ n, ...measureProject(parser, root) });
  }

  console.log(`parser init (wasm load, once per host activation): ${ms(initMs)} ms`);
  console.log('');
  console.log('| n   | .cs files | cold total (ms) | read | parse | facts | assemble | increment (ms, median of 5) | nodes | edges | truncated |');
  console.log('| --- | --------- | --------------- | ---- | ----- | ----- | -------- | --------------------------- | ----- | ----- | --------- |');
  for (const r of results) {
    console.log(
      `| ${r.n} | ${r.files} | ${ms(r.coldMs)} | ${ms(r.readMs)} | ${ms(r.parseMs)} | ` +
        `${ms(r.factsMs)} | ${ms(r.assembleMs)} | ${ms(r.incrementMs)} | ` +
        `${r.nodes} | ${r.edges} | ${r.truncated} |`
    );
  }
  console.log('');
  for (const r of results) {
    console.log(`n=${r.n} node kinds: ${JSON.stringify(r.nodeKinds)}`);
  }
  console.log('');

  // Budget verdicts (G2).
  let failed = false;
  const at50 = results.find((r) => r.n === 50);
  if (at50 !== undefined) {
    const pass = at50.coldMs <= COLD_BUDGET_MS_AT_50;
    failed ||= !pass;
    console.log(
      `cold(50) ${ms(at50.coldMs)} ms ≤ ${COLD_BUDGET_MS_AT_50} ms — ${pass ? 'PASS' : 'FAIL'}`
    );
  }
  for (const r of results) {
    const pass = r.incrementMs <= INCREMENT_BUDGET_MS;
    failed ||= !pass;
    console.log(
      `increment(${r.n}) ${ms(r.incrementMs)} ms ≤ ${INCREMENT_BUDGET_MS} ms — ${pass ? 'PASS' : 'FAIL'}`
    );
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    disposeCSharpParser();
  });
