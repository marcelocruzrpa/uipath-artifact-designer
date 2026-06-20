/**
 * M0 corpus spike — runs the PRODUCTION coded-workflow classifier modules
 * over a corpus of real UiPath repos and emits the decision data for the
 * tier-2 transpiler whitelist:
 *
 *   - per-workflow tier-1 / tier-3 statement ratios, and
 *   - a frequency-ranked list of unmatched-statement signatures
 *     (`normalizeStatement` buckets) with examples.
 *
 * Usage:
 *   npx tsx scripts/corpusSpike.ts \
 *     --corpus ./corpus --out corpus-report.json --md corpus-report.md
 *
 * STATEMENT COUNTING RULE
 *   Control-flow statements (`if_statement`, `for_statement`,
 *   `foreach_statement`, `while_statement`, `do_statement`, `try_statement`,
 *   `switch_statement`, `using_statement`, `block`,
 *   `local_function_statement`) are CONTAINERS: we recurse into their
 *   bodies/clauses without counting the container itself.  Everything else
 *   at statement level (expression_statement, local_declaration_statement,
 *   return/throw/yield/break/continue/lock/...) is a LEAF and is tallied.
 *   A `using_statement`'s resource declarator still feeds handle tracking
 *   even though the container itself is not counted.  Expression-bodied
 *   methods (`=> expr;`) are counted as ONE leaf and fall into the
 *   `stmt:arrow_expression_clause` bucket (rare; kept visible on purpose).
 *
 * HANDLE-TRACKING CAVEAT
 *   Handle tracking is deliberately over-approximate in the seed: any
 *   variable initialized from a service-rooted call is treated as a service
 *   handle, so later member calls on it count as tier-1.  M0 numbers should
 *   be read with that in mind.
 *
 * This file lives OUTSIDE the purity boundary (scripts/ is not included in
 * tsconfig.json or the extension bundle), so Node imports are allowed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { Node } from 'web-tree-sitter';

import {
  configureCSharpParser,
  getCSharpParser,
  disposeCSharpParser,
  type CSharpParserHandle
} from '../src/model/codedWorkflow/parser';
import { isCodedWorkflowSource } from '../src/model/codedWorkflow/detectSource';
import { matchTier1 } from '../src/model/codedWorkflow/classify/tier1Match';
import {
  createHandleMap,
  trackHandle,
  type HandleMap
} from '../src/model/codedWorkflow/classify/handleTracking';
import { normalizeStatement } from '../src/model/codedWorkflow/normalizeStatement';
import { applyTier2 } from '../src/model/codedWorkflow/classify/tier2Rules';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  corpusDir: string;
  jsonOut: string;
  mdOut: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    corpusDir: './corpus',
    jsonOut: 'corpus-report.json',
    mdOut: 'corpus-report.md'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    switch (flag) {
      case '--corpus':
        opts.corpusDir = value;
        break;
      case '--out':
        opts.jsonOut = value;
        break;
      case '--md':
        opts.mdOut = value;
        break;
      default:
        throw new Error(
          `unknown flag ${flag} — usage: ` +
            'corpusSpike.ts [--corpus <dir>] [--out <json>] [--md <md>]'
        );
    }
    i += 1;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

/**
 * Path segments never analyzed (build output, scaffolding, VCS). Mirrors the
 * PRODUCTION discovery exclusions (`codedProjectIndex.ts` EXCLUDE_GLOB),
 * including `.local` (UiPath's generated activity-wrapper partials), so corpus
 * numbers reflect exactly the files the extension renders.
 */
const EXCLUDED_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  'bin',
  'obj',
  '.local',
  '.codedworkflows',
  'properties',
  '.git'
]);

function isGeneratedBasename(basename: string): boolean {
  const lower = basename.toLowerCase();
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
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
      out.push(join(dir, entry.name));
    }
  }
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** Statement node types per the grammar's `statement` supertype. */
const STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'block',
  'break_statement',
  'checked_statement',
  'continue_statement',
  'do_statement',
  'empty_statement',
  'expression_statement',
  'fixed_statement',
  'for_statement',
  'foreach_statement',
  'goto_statement',
  'if_statement',
  'labeled_statement',
  'local_declaration_statement',
  'local_function_statement',
  'lock_statement',
  'preproc_if',
  'return_statement',
  'switch_statement',
  'throw_statement',
  'try_statement',
  'unsafe_statement',
  'using_statement',
  'while_statement',
  'yield_statement'
]);

/** Last identifier segment of a type name (`A.B.CodedWorkflow` → `CodedWorkflow`). */
function lastTypeNameSegment(node: Node): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text;
    case 'qualified_name': {
      const name = node.childForFieldName('name');
      return name !== null ? lastTypeNameSegment(name) : null;
    }
    case 'generic_name': {
      const id = node.namedChildren.find((c) => c.type === 'identifier');
      return id !== undefined ? id.text : null;
    }
    case 'primary_constructor_base_type': {
      for (const child of node.namedChildren) {
        const seg = lastTypeNameSegment(child);
        if (seg !== null) return seg;
      }
      return null;
    }
    default:
      return null;
  }
}

/** All `class_declaration` nodes in the tree (namespaces, nesting included). */
function collectClassDeclarations(root: Node): Node[] {
  const classes: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (node.type === 'class_declaration') classes.push(node);
    for (let i = node.namedChildCount - 1; i >= 0; i -= 1) {
      const child = node.namedChild(i);
      if (child !== null) stack.push(child);
    }
  }
  return classes;
}

/** True when the base list names `CodedWorkflow` as its last segment. */
function extendsCodedWorkflow(classDecl: Node): boolean {
  const baseList = classDecl.namedChildren.find((c) => c.type === 'base_list');
  if (baseList === undefined) return false;
  return baseList.namedChildren.some(
    (base) => lastTypeNameSegment(base) === 'CodedWorkflow'
  );
}

/** True when the method carries a `[Workflow]` or `[TestCase]` attribute. */
function isEntryPointMethod(method: Node): boolean {
  for (const child of method.namedChildren) {
    if (child.type !== 'attribute_list') continue;
    for (const attr of child.namedChildren) {
      if (attr.type !== 'attribute') continue;
      const name = attr.childForFieldName('name');
      const seg = name !== null ? lastTypeNameSegment(name) : null;
      if (seg === 'Workflow' || seg === 'TestCase') return true;
    }
  }
  return false;
}

/** Direct `method_declaration` children of the class body. */
function classMethods(classDecl: Node): Node[] {
  const body = classDecl.childForFieldName('body');
  if (body === null) return [];
  return body.namedChildren.filter((c) => c.type === 'method_declaration');
}

// ---------------------------------------------------------------------------
// Statement walking + tallying
// ---------------------------------------------------------------------------

interface PatternExample {
  /** Corpus-relative path, forward slashes. */
  file: string;
  /** 1-based line of the statement start. */
  line: number;
  /** First 120 chars of the statement, whitespace collapsed. */
  code: string;
}

interface PatternBucket {
  count: number;
  examples: PatternExample[];
}

const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_CODE = 120;

interface WalkContext {
  source: string;
  relFile: string;
  handles: HandleMap;
  tier1: number;
  tier2: number;
  tier3: number;
  buckets: Map<string, PatternBucket>;
  /** Corpus-shared tally of which tier-2 rule claimed each tier-2 leaf. */
  tier2ByRule: Map<string, number>;
}

function exampleCode(stmt: Node, source: string): string {
  return source
    .slice(stmt.startIndex, stmt.endIndex)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXAMPLE_CODE);
}

/** Tally one LEAF statement: track handles, then tier-1 / tier-2 / bucket. */
function countLeaf(stmt: Node, ctx: WalkContext): void {
  trackHandle(ctx.handles, stmt);
  if (matchTier1(stmt, ctx.handles) !== null) {
    ctx.tier1 += 1;
    return;
  }
  // Tier-2: the production whitelist engine (same `applyTier2` the model uses).
  const pseudo = applyTier2(stmt, ctx.source);
  if (pseudo !== null) {
    ctx.tier2 += 1;
    ctx.tier2ByRule.set(pseudo.ruleId, (ctx.tier2ByRule.get(pseudo.ruleId) ?? 0) + 1);
    return;
  }
  ctx.tier3 += 1;
  const signature = normalizeStatement(stmt, ctx.source, ctx.handles);
  let bucket = ctx.buckets.get(signature);
  if (bucket === undefined) {
    bucket = { count: 0, examples: [] };
    ctx.buckets.set(signature, bucket);
  }
  bucket.count += 1;
  if (bucket.examples.length < MAX_EXAMPLES) {
    bucket.examples.push({
      file: ctx.relFile,
      line: stmt.startPosition.row + 1,
      code: exampleCode(stmt, ctx.source)
    });
  }
}

function visitOptional(node: Node | null, ctx: WalkContext): void {
  if (node !== null) visitStatement(node, ctx);
}

/** Visit one statement node: recurse through containers, tally leaves. */
function visitStatement(stmt: Node, ctx: WalkContext): void {
  switch (stmt.type) {
    case 'comment':
      return;
    case 'block':
      for (const child of stmt.namedChildren) visitStatement(child, ctx);
      return;
    case 'if_statement':
      visitOptional(stmt.childForFieldName('consequence'), ctx);
      visitOptional(stmt.childForFieldName('alternative'), ctx);
      return;
    case 'for_statement':
    case 'foreach_statement':
    case 'while_statement':
    case 'do_statement':
      visitOptional(stmt.childForFieldName('body'), ctx);
      return;
    case 'using_statement':
      // Container, but its resource declarator still feeds handle tracking.
      trackHandle(ctx.handles, stmt);
      visitOptional(stmt.childForFieldName('body'), ctx);
      return;
    case 'try_statement': {
      visitOptional(stmt.childForFieldName('body'), ctx);
      for (const clause of stmt.namedChildren) {
        if (clause.type === 'catch_clause') {
          visitOptional(clause.childForFieldName('body'), ctx);
        } else if (clause.type === 'finally_clause') {
          const block = clause.namedChildren.find((c) => c.type === 'block');
          if (block !== undefined) visitStatement(block, ctx);
        }
      }
      return;
    }
    case 'switch_statement': {
      const body = stmt.childForFieldName('body');
      if (body === null) return;
      for (const section of body.namedChildren) {
        if (section.type !== 'switch_section') continue;
        for (const child of section.namedChildren) {
          if (STATEMENT_TYPES.has(child.type)) visitStatement(child, ctx);
        }
      }
      return;
    }
    case 'local_function_statement':
      visitMethodBody(stmt.childForFieldName('body'), ctx);
      return;
    default:
      countLeaf(stmt, ctx);
  }
}

/** Walk a method (or local function) body: block or `=> expr` clause. */
function visitMethodBody(body: Node | null, ctx: WalkContext): void {
  if (body === null) return;
  if (body.type === 'block') {
    visitStatement(body, ctx);
  } else if (body.type === 'arrow_expression_clause') {
    // Expression-bodied member: counted as one leaf (see header).
    countLeaf(body, ctx);
  }
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface WorkflowRow {
  file: string;
  class: string;
  /** `[Workflow]`/`[TestCase]` method names, source order, comma-joined. */
  entryPoint: string;
  statements: number;
  tier1: number;
  tier2: number;
  tier3: number;
  tier1Ratio: number;
  /** (tier1 + tier2) / statements — the Goal-3 legibility coverage metric. */
  coverageRatio: number;
}

interface UnmatchedPattern {
  signature: string;
  count: number;
  pctOfTier3: number;
  examples: PatternExample[];
}

interface CorpusCounts {
  csFiles: number;
  workflowFiles: number;
  helperFiles: number;
  generatedFiles: number;
  sniffFalsePositives: number;
  filesWithParseErrors: number;
}

interface Report {
  generatedAt: string;
  corpus: CorpusCounts;
  workflows: WorkflowRow[];
  aggregate: {
    statements: number;
    tier1: number;
    tier2: number;
    tier3: number;
    tier1Ratio: number;
    /** (tier1 + tier2) / statements — the Goal-3 coverage metric. */
    coverageRatio: number;
    /** Tier-2 leaves per rule id, descending by count. */
    tier2ByRule: { ruleId: string; count: number }[];
    projectedTierRatioWithTopKBuckets: { k: number; ratio: number }[];
  };
  unmatchedPatterns: UnmatchedPattern[];
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

function ratio2(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round2(numerator / denominator);
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

interface FileAnalysis {
  /** One row per workflow class found in the file. */
  rows: WorkflowRow[];
  hadParseError: boolean;
}

function analyzeWorkflowFile(
  parser: CSharpParserHandle,
  source: string,
  relFile: string,
  buckets: Map<string, PatternBucket>,
  tier2ByRule: Map<string, number>
): FileAnalysis {
  const tree = parser.parse(source);
  const rows: WorkflowRow[] = [];

  for (const classDecl of collectClassDeclarations(tree.rootNode)) {
    const methods = classMethods(classDecl);
    const entryMethods = methods.filter(isEntryPointMethod);
    if (!extendsCodedWorkflow(classDecl) && entryMethods.length === 0) {
      continue; // not a workflow class
    }

    const nameNode = classDecl.childForFieldName('name');
    const className = nameNode !== null ? nameNode.text : '(anonymous)';

    let tier1 = 0;
    let tier2 = 0;
    let tier3 = 0;
    for (const method of methods) {
      const ctx: WalkContext = {
        source,
        relFile,
        handles: createHandleMap(), // one HandleMap per method
        tier1: 0,
        tier2: 0,
        tier3: 0,
        buckets,
        tier2ByRule
      };
      visitMethodBody(method.childForFieldName('body'), ctx);
      tier1 += ctx.tier1;
      tier2 += ctx.tier2;
      tier3 += ctx.tier3;
    }

    const entryNames = entryMethods
      .map((m) => m.childForFieldName('name')?.text ?? '(unnamed)')
      .join(', ');
    const statements = tier1 + tier2 + tier3;
    rows.push({
      file: relFile,
      class: className,
      entryPoint: entryNames === '' ? '(none)' : entryNames,
      statements,
      tier1,
      tier2,
      tier3,
      tier1Ratio: ratio2(tier1, statements),
      coverageRatio: ratio2(tier1 + tier2, statements)
    });
  }

  return { rows, hadParseError: tree.rootNode.hasError };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function mdEscape(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/`/g, "'");
}

function mdCode(text: string): string {
  return `\`${mdEscape(text)}\``;
}

function renderMarkdown(report: Report): string {
  const { corpus, aggregate } = report;
  const lines: string[] = [];

  lines.push('# M0 Corpus Spike Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(
    '> Handle tracking is deliberately over-approximate in the seed (any ' +
      'variable initialized from a service call is treated as a service ' +
      'handle) — read tier-1 ratios with that in mind.'
  );
  lines.push('');

  lines.push('## Corpus');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| .cs files | ${corpus.csFiles} |`);
  lines.push(`| Workflow files | ${corpus.workflowFiles} |`);
  lines.push(`| Helper files | ${corpus.helperFiles} |`);
  lines.push(`| Generated files (excluded) | ${corpus.generatedFiles} |`);
  lines.push(`| Sniff false positives | ${corpus.sniffFalsePositives} |`);
  lines.push(`| Files with parse errors | ${corpus.filesWithParseErrors} |`);
  lines.push('');

  lines.push('## Top 20 workflows by statement count');
  lines.push('');
  lines.push(
    '| File | Class | Entry point | Stmts | Tier 1 | Tier 2 | Tier 3 | Coverage |'
  );
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.workflows.slice(0, 20)) {
    lines.push(
      `| ${mdEscape(row.file)} | ${mdEscape(row.class)} | ` +
        `${mdEscape(row.entryPoint)} | ${row.statements} | ${row.tier1} | ` +
        `${row.tier2} | ${row.tier3} | ${row.coverageRatio.toFixed(2)} |`
    );
  }
  lines.push('');

  lines.push('## Aggregate');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | ---: |');
  lines.push(`| Leaf statements | ${aggregate.statements} |`);
  lines.push(`| Tier 1 | ${aggregate.tier1} |`);
  lines.push(`| Tier 2 | ${aggregate.tier2} |`);
  lines.push(`| Tier 3 | ${aggregate.tier3} |`);
  lines.push(`| Tier-1 ratio | ${aggregate.tier1Ratio.toFixed(2)} |`);
  lines.push(
    `| **Coverage (tier 1+2) ratio** | **${aggregate.coverageRatio.toFixed(2)}** |`
  );
  lines.push('');

  lines.push('### Tier-2 leaves by rule');
  lines.push('');
  if (aggregate.tier2ByRule.length === 0) {
    lines.push('_No tier-2 rules matched._');
  } else {
    lines.push('| Rule | Count | % of statements |');
    lines.push('| --- | ---: | ---: |');
    for (const { ruleId, count } of aggregate.tier2ByRule) {
      const pct = aggregate.statements === 0 ? 0 : (count / aggregate.statements) * 100;
      lines.push(`| ${mdCode(ruleId)} | ${count} | ${pct.toFixed(1)} |`);
    }
  }
  lines.push('');
  lines.push(
    '### Projected coverage if the top K remaining tier-3 buckets became rules'
  );
  lines.push('');
  lines.push('| K | Projected ratio |');
  lines.push('| ---: | ---: |');
  for (const { k, ratio } of aggregate.projectedTierRatioWithTopKBuckets) {
    lines.push(`| ${k} | ${ratio.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('## Top 50 unmatched signatures');
  lines.push('');
  lines.push('| # | Signature | Count | % of tier 3 | Example |');
  lines.push('| ---: | --- | ---: | ---: | --- |');
  report.unmatchedPatterns.slice(0, 50).forEach((pattern, i) => {
    const ex = pattern.examples[0];
    const example =
      ex !== undefined
        ? `${mdEscape(ex.file)}:${ex.line} ${mdCode(ex.code)}`
        : '—';
    lines.push(
      `| ${i + 1} | ${mdCode(pattern.signature)} | ${pattern.count} | ` +
        `${pattern.pctOfTier3.toFixed(1)} | ${example} |`
    );
  });
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const corpusRoot = resolve(opts.corpusDir);

  // Same wasm resolution the tests use, hand-rolled here so the script does
  // not import from tests/.
  const nodeRequire = createRequire(__filename);
  configureCSharpParser({
    runtimeWasmPath: nodeRequire.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    grammarWasmPath: join(
      dirname(nodeRequire.resolve('tree-sitter-c-sharp/package.json')),
      'tree-sitter-c_sharp.wasm'
    )
  });
  const parser = await getCSharpParser();

  const csFiles: string[] = [];
  collectCsFiles(corpusRoot, csFiles);

  const counts: CorpusCounts = {
    csFiles: csFiles.length,
    workflowFiles: 0,
    helperFiles: 0,
    generatedFiles: 0,
    sniffFalsePositives: 0,
    filesWithParseErrors: 0
  };
  const buckets = new Map<string, PatternBucket>();
  const tier2ByRule = new Map<string, number>();
  const workflows: WorkflowRow[] = [];

  for (const file of csFiles) {
    if (isGeneratedBasename(basename(file))) {
      counts.generatedFiles += 1;
      continue;
    }
    const source = readFileSync(file, 'utf8');
    if (!isCodedWorkflowSource(source)) {
      counts.helperFiles += 1;
      continue;
    }
    const relFile = relative(corpusRoot, file).replace(/\\/g, '/');
    const { rows, hadParseError } = analyzeWorkflowFile(
      parser,
      source,
      relFile,
      buckets,
      tier2ByRule
    );
    if (hadParseError) counts.filesWithParseErrors += 1;
    if (rows.length === 0) {
      // Sniffed positive but no workflow class at the AST level.
      counts.helperFiles += 1;
      counts.sniffFalsePositives += 1;
      continue;
    }
    counts.workflowFiles += 1;
    workflows.push(...rows);
  }

  // Deterministic ordering everywhere.
  workflows.sort(
    (a, b) =>
      b.statements - a.statements ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      (a.class < b.class ? -1 : a.class > b.class ? 1 : 0)
  );

  const tier1 = workflows.reduce((sum, w) => sum + w.tier1, 0);
  const tier2 = workflows.reduce((sum, w) => sum + w.tier2, 0);
  const tier3 = workflows.reduce((sum, w) => sum + w.tier3, 0);
  const statements = tier1 + tier2 + tier3;

  const tier2ByRuleSorted = [...tier2ByRule.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
    );

  const unmatchedPatterns: UnmatchedPattern[] = [...buckets.entries()]
    .map(([signature, bucket]) => ({
      signature,
      count: bucket.count,
      pctOfTier3: tier3 === 0 ? 0 : round1((bucket.count / tier3) * 100),
      examples: bucket.examples
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
    );

  const projectedTierRatioWithTopKBuckets = [5, 10, 15].map((k) => {
    const covered = unmatchedPatterns
      .slice(0, k)
      .reduce((sum, p) => sum + p.count, 0);
    return { k, ratio: ratio2(tier1 + tier2 + covered, statements) };
  });

  const report: Report = {
    generatedAt: new Date().toISOString(),
    corpus: counts,
    workflows,
    aggregate: {
      statements,
      tier1,
      tier2,
      tier3,
      tier1Ratio: ratio2(tier1, statements),
      coverageRatio: ratio2(tier1 + tier2, statements),
      tier2ByRule: tier2ByRuleSorted,
      projectedTierRatioWithTopKBuckets
    },
    unmatchedPatterns
  };

  writeFileSync(resolve(opts.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(opts.mdOut), renderMarkdown(report));

  // Console summary.
  console.log(
    `corpus: ${counts.csFiles} .cs files — ${counts.workflowFiles} workflow, ` +
      `${counts.helperFiles} helper, ${counts.generatedFiles} generated, ` +
      `${counts.sniffFalsePositives} sniff false positives, ` +
      `${counts.filesWithParseErrors} with parse errors`
  );
  console.log(
    `aggregate: ${statements} leaf statements — tier1 ${tier1}, ` +
      `tier2 ${tier2}, tier3 ${tier3}, ` +
      `coverage ${report.aggregate.coverageRatio.toFixed(2)} ` +
      `(tier1 ratio ${report.aggregate.tier1Ratio.toFixed(2)})`
  );
  if (tier2ByRuleSorted.length > 0) {
    console.log('tier-2 by rule:');
    for (const { ruleId, count } of tier2ByRuleSorted) {
      console.log(`  ${String(count).padStart(5)}  ${ruleId}`);
    }
  }
  for (const { k, ratio } of projectedTierRatioWithTopKBuckets) {
    console.log(`  +top-${k} remaining buckets → ${ratio.toFixed(2)}`);
  }
  console.log('top unmatched signatures:');
  for (const p of unmatchedPatterns.slice(0, 10)) {
    console.log(`  ${String(p.count).padStart(5)}  ${p.signature}`);
  }
  console.log(`wrote ${opts.jsonOut} and ${opts.mdOut}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    disposeCSharpParser();
  });
