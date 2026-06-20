/**
 * dumpModel — a dev-only verification oracle for the Coded Workflow canvas.
 *
 * Runs the PRODUCTION classifier (`buildModel`) over a single `.cs` file and
 * prints, per entry point (and helper method), an indented statement TREE that
 * mirrors exactly what the canvas renders:
 *   - cards   (tier 1): `[T1] <title> — <arg label=value, …>`  (+ `→ binding`)
 *   - pseudo  (tier 2): `[T2 ruleId] <title> — <text>`
 *   - chips   (tier 3): `[T3 ×N] <code>  (lines A-B)`
 *   - containers:       `<KIND> <header>` then each slot `<role/label>:` nested
 * followed by the per-method tier counts and the file totals.
 *
 * With `--project <dir>` it ALSO builds the project call graph using the pure
 * `graphFacts` + `assembleGraph` layer the way `graphAssemble.test.ts` drives
 * it (discover `*.cs`, parse, extract facts, assemble with a real
 * `xamlFileExists` probe and the project.json entry points) and prints every
 * node and edge with its kind / resolved-ness / reason.  This is how every
 * legibility fixture is VERIFIED to render as intended before it ships.
 *
 * Usage:
 *   npx tsx scripts/dumpModel.ts <file.cs>
 *   npx tsx scripts/dumpModel.ts <file.cs> --project <projectDir>
 *   npx tsx scripts/dumpModel.ts --project <projectDir>   # graph only
 *
 * This file lives OUTSIDE the purity boundary (scripts/ is not in tsconfig.json
 * or the extension bundle), so Node imports are allowed — same as corpusSpike.ts.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';

import {
  configureCSharpParser,
  getCSharpParser,
  disposeCSharpParser,
  type CSharpParserHandle
} from '../src/model/codedWorkflow/parser';
import { buildModel } from '../src/model/codedWorkflow/buildModel';
import {
  extractFileFacts,
  type FileFacts
} from '../src/model/codedWorkflow/graph/graphFacts';
import { assembleGraph } from '../src/model/codedWorkflow/graph/assembleGraph';
import type {
  CodedWorkflowModel,
  CwArgSummary,
  CwStatement,
  CwSlot,
  CwActivityCard,
  CwTierCounts
} from '../src/model/codedWorkflow/cwTypes';
import type { CodedProjectGraph } from '../src/model/codedWorkflow/graph/graphTypes';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  /** Single `.cs` file to classify; undefined in graph-only mode. */
  file: string | undefined;
  /** Project dir for `--project` graph mode; undefined when absent. */
  project: string | undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { file: undefined, project: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('missing value for --project');
      opts.project = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(
        `unknown flag ${arg} — usage: dumpModel.ts <file.cs> [--project <dir>]`
      );
    } else if (opts.file === undefined) {
      opts.file = arg;
    } else {
      throw new Error(`unexpected extra argument ${arg}`);
    }
  }
  if (opts.file === undefined && opts.project === undefined) {
    throw new Error('usage: dumpModel.ts <file.cs> [--project <dir>]');
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Parser wiring (same wasm resolution corpusSpike.ts uses)
// ---------------------------------------------------------------------------

async function makeParser(): Promise<CSharpParserHandle> {
  const nodeRequire = createRequire(__filename);
  configureCSharpParser({
    runtimeWasmPath: nodeRequire.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    grammarWasmPath: join(
      dirname(nodeRequire.resolve('tree-sitter-c-sharp/package.json')),
      'tree-sitter-c_sharp.wasm'
    )
  });
  return getCSharpParser();
}

// ---------------------------------------------------------------------------
// Statement-tree rendering
// ---------------------------------------------------------------------------

const INDENT = '  ';

/** Render one card's arg summaries as `label=value` joined by ', '. */
function renderArgs(args: CwArgSummary[]): string {
  if (args.length === 0) return '';
  return args.map((a) => `${a.label}=${a.value}`).join(', ');
}

/** 1-based inclusive line range of a statement, for display. */
function lineRange(card: { span: CwStatement['span'] }): string {
  const { startLine, endLine } = card.span;
  return startLine === endLine
    ? `line ${startLine + 1}`
    : `lines ${startLine + 1}-${endLine + 1}`;
}

function renderCard(card: CwActivityCard): string {
  const argText = renderArgs(card.args);
  const binding = card.resultBinding !== undefined ? `  → ${card.resultBinding}` : '';
  const body = argText !== '' ? `  —  ${argText}` : '';
  return `[T1] ${card.title}${body}${binding}   (${card.service}.${card.method})`;
}

/** Print one statement (and its descendants) at `depth`. */
function printStatement(stmt: CwStatement, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  switch (stmt.type) {
    case 'activity':
      out.push(`${pad}${renderCard(stmt)}`);
      break;
    case 'pseudo':
      out.push(`${pad}[T2 ${stmt.ruleId}] ${stmt.title}  —  ${stmt.text}`);
      break;
    case 'raw': {
      const flat = stmt.code.replace(/\s+/g, ' ').trim();
      const mult = stmt.statementCount > 1 ? ` ×${stmt.statementCount}` : '';
      const helper =
        stmt.helperTarget !== undefined ? `  →helper ${stmt.helperTarget.name}` : '';
      out.push(`${pad}[T3${mult}] ${flat}${helper}   (${lineRange(stmt)})`);
      break;
    }
    case 'container': {
      const collapsed = stmt.collapsedByDefault ? '  [collapsed]' : '';
      out.push(`${pad}<${stmt.kind.toUpperCase()}> ${stmt.header}${collapsed}`);
      if (stmt.stateMachine !== undefined) {
        const sm = stmt.stateMachine;
        out.push(`${pad}${INDENT}· stateMachine(${sm.stateVar}):`);
        for (const st of sm.states) {
          const tr = st.transitions.length > 0 ? ` → ${st.transitions.join(', ')}` : ' (terminal)';
          out.push(`${pad}${INDENT}    ${st.label}${tr}`);
        }
      }
      if (stmt.resourceCard !== undefined) {
        out.push(`${pad}${INDENT}· resource: ${renderCard(stmt.resourceCard)}`);
      }
      for (const slot of stmt.slots) {
        printSlot(slot, depth + 1, out);
      }
      break;
    }
  }
}

function printSlot(slot: CwSlot, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  out.push(`${pad}${slot.role} «${slot.label}»`);
  if (slot.children.length === 0) {
    out.push(`${pad}${INDENT}(empty)`);
    return;
  }
  for (const child of slot.children) {
    printStatement(child, depth + 1, out);
  }
}

function counts(c: CwTierCounts): string {
  return `tier1=${c.tier1} tier2=${c.tier2} tier3=${c.tier3}`;
}

/** Print the full model: classes → entry points + helpers → trees + counts. */
function printModel(model: CodedWorkflowModel, out: string[]): void {
  out.push(`FILE: ${model.fileName}`);
  out.push(
    `parseHealth=${model.parseHealth} parseErrors=${model.parseErrorCount} ` +
      `truncated=${model.truncated} totalLines=${model.totalLines}`
  );
  out.push(
    `TOTALS: ${counts(model.stats)} (statements=${model.stats.totalStatements})`
  );
  if (model.otherClassNames.length > 0) {
    out.push(`otherClasses: ${model.otherClassNames.join(', ')}`);
  }
  out.push('');

  for (const cls of model.classes) {
    const ns = cls.namespace !== undefined ? `${cls.namespace}.` : '';
    out.push(`CLASS ${ns}${cls.className} : ${cls.baseType}`);

    for (const ep of cls.entryPoints) {
      const sig = ep.signatureSummary !== '' ? ` (${ep.signatureSummary})` : '';
      out.push(`  ENTRY [${ep.attribute}] ${ep.name}${sig}   ${counts(ep.tierCounts)}`);
      if (ep.body.length === 0) out.push(`${INDENT.repeat(2)}(empty)`);
      for (const stmt of ep.body) printStatement(stmt, 2, out);
      out.push('');
    }

    for (const hm of cls.helperMethods) {
      out.push(`  HELPER ${hm.name}   ${counts(hm.tierCounts)}`);
      for (const stmt of hm.body) printStatement(stmt, 2, out);
      out.push('');
    }
  }
}

// ---------------------------------------------------------------------------
// Project graph (drives the pure graphFacts/assembleGraph layer)
// ---------------------------------------------------------------------------

/**
 * Path segments never analyzed — mirrors the PRODUCTION discovery exclusions
 * (`codedProjectIndex.ts` EXCLUDE_GLOB: bin/obj/.local/.settings/.objects/.tmh/
 * .codedworkflows) so this oracle sees exactly the files the extension does.
 * `.local` holds UiPath's generated activity-wrapper partials; scanning them
 * would diverge the oracle from production.
 */
const EXCLUDED_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  'bin',
  'obj',
  '.local',
  '.codedworkflows',
  'properties',
  '.git'
]);

function isGeneratedBasename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('_proxy.cs') || lower.endsWith('.g.cs');
}

/** Recursively collect `*.cs` files, depth-first, lexicographically sorted. */
function collectCsFiles(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry.name.toLowerCase())) continue;
      collectCsFiles(join(dir, entry.name), out);
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.cs') &&
      !isGeneratedBasename(entry.name)
    ) {
      out.push(join(dir, entry.name));
    }
  }
}

/** Read project.json entry points as normalized rel paths (forward slashes). */
function readEntryPointRelPaths(projectRoot: string): Set<string> {
  const manifest = join(projectRoot, 'project.json');
  const set = new Set<string>();
  if (!existsSync(manifest)) return set;
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      entryPoints?: Array<{ filePath?: string }>;
    };
    for (const ep of parsed.entryPoints ?? []) {
      if (typeof ep.filePath === 'string') set.add(ep.filePath.replace(/\\/g, '/'));
    }
  } catch {
    // Malformed manifest → no entry points (graph falls back to attr/Main).
  }
  return set;
}

function buildProjectGraph(
  parser: CSharpParserHandle,
  projectRoot: string
): CodedProjectGraph {
  const root = resolve(projectRoot);
  const csFiles: string[] = [];
  collectCsFiles(root, csFiles);

  const files: Array<FileFacts & { uri?: string }> = csFiles.map((absPath) => {
    const relPath = relative(root, absPath).replace(/\\/g, '/');
    const source = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
    const tree = parser.parse(source);
    try {
      return {
        ...extractFileFacts(relPath, source, tree),
        uri: `file:///${absPath.replace(/\\/g, '/')}`
      };
    } finally {
      tree.delete();
    }
  });

  // Real existence probe: an xaml rel path resolves under the project root.
  const xamlFileExists = (normRelPath: string): boolean => {
    const abs = join(root, ...normRelPath.split('/'));
    return existsSync(abs) && statSync(abs).isFile();
  };

  return assembleGraph({
    projectName: basename(root),
    projectRootUri: `file:///${root.replace(/\\/g, '/')}`,
    entryPointRelPaths: readEntryPointRelPaths(root),
    files,
    xamlFileExists
  });
}

function printGraph(graph: CodedProjectGraph, out: string[]): void {
  out.push(`PROJECT GRAPH: ${graph.projectName}`);
  out.push(`truncated=${graph.truncated}  nodes=${graph.nodes.length}  edges=${graph.edges.length}`);
  out.push('');
  out.push('NODES:');
  for (const node of graph.nodes) {
    const entry = node.isEntryPoint ? ' [entry]' : '';
    const stale = node.stale ? ' [stale]' : '';
    const uri = node.uri !== undefined ? '' : ' (no-uri)';
    out.push(`  (${node.kind}) ${node.label}${entry}${stale}${uri}   id=${node.id}`);
  }
  out.push('');
  out.push('EDGES:');
  for (const edge of graph.edges) {
    const style = edge.resolved ? 'solid' : 'dashed';
    const reason = edge.unresolvedReason !== undefined ? ` reason=${edge.unresolvedReason}` : '';
    const count = edge.count > 1 ? ` ×${edge.count}` : '';
    out.push(`  ${style} [${edge.kind}]${reason}${count}  ${edge.source}  ->  ${edge.target}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const parser = await makeParser();
  const out: string[] = [];

  if (opts.file !== undefined) {
    const absFile = resolve(opts.file);
    const source = readFileSync(absFile, 'utf8').replace(/\r\n/g, '\n');
    const parseStart = globalThis.performance?.now?.() ?? 0;
    const tree = parser.parse(source);
    try {
      const model = buildModel(tree, source, {
        fileName: basename(absFile),
        fileUri: `file:///${absFile.replace(/\\/g, '/')}`,
        parseMs: (globalThis.performance?.now?.() ?? 0) - parseStart
      });
      printModel(model, out);
    } finally {
      tree.delete();
    }
  }

  if (opts.project !== undefined) {
    if (opts.file !== undefined) out.push('='.repeat(72), '');
    const graph = buildProjectGraph(parser, opts.project);
    printGraph(graph, out);
  }

  console.log(out.join('\n'));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    disposeCSharpParser();
  });
