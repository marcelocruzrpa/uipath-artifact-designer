/**
 * HOST-SIDE incremental index of one coded-workflow project's call-graph
 * facts (T2.2).  Owns the I/O the pure layer (T2.1) was designed without:
 * file discovery via `workspace.findFiles`, mtime/size-validated fact
 * caching, dirty-buffer substitution for the active document, the
 * xaml-existence probe, and `buildMs` stamping.
 *
 * One index per project root, kept in a module-level registry
 * (`CodedProjectIndex.for`) so repeated renders — and multiple open
 * documents of the same project — share the per-file fact cache.  Builds are
 * serialized per index: two overlapping `getGraph` calls would interleave
 * cache mutations.
 *
 * Host-only module — imports `vscode`; never bundled into the webview.
 */
import * as vscode from 'vscode';
import { assembleGraph } from '../model/codedWorkflow/graph/assembleGraph';
import { extractFileFacts, type FileFacts } from '../model/codedWorkflow/graph/graphFacts';
import type { CodedProjectGraph } from '../model/codedWorkflow/graph/graphTypes';
import { nowMs } from '../model/codedWorkflow/buildModel';
import { getCSharpParser } from '../model/codedWorkflow/parser';
import { stripBom } from '../util/fsHelpers';
import { logInfo, logWarn } from '../util/log';
import { readProjectInfo, relPathInProject } from './codedProject';

/**
 * Directories excluded from discovery: build output (`bin`/`obj`) and
 * UiPath Studio metadata folders, none of which hold user workflows.
 */
const EXCLUDE_GLOB =
  '{**/bin/**,**/obj/**,**/.local/**,**/.settings/**,**/.objects/**,**/.tmh/**,**/.codedworkflows/**}';

interface CachedFileFacts {
  mtimeMs: number;
  size: number;
  /**
   * FNV-1a fingerprint of the decoded source (see {@link fingerprint}). The
   * authoritative validity key: `mtimeMs`/`size` alone are unsound — a
   * same-length external edit, or a git checkout that restores a file's mtime
   * AND size, would otherwise serve stale call-graph facts for OTHER documents.
   */
  hash: number;
  facts: FileFacts;
}

/** On Windows file systems path comparison must be case-insensitive. */
function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * 32-bit FNV-1a hash of a string — a cheap, non-cryptographic content
 * fingerprint used to validate the per-file fact cache. A collision would at
 * worst serve stale facts for one file (the exact failure the mtime+size check
 * already had); FNV-1a's distribution makes that astronomically unlikely for
 * source files, and computing it is far cheaper than the tree-sitter parse it
 * lets us skip.
 */
function fingerprint(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // h * 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class CodedProjectIndex {
  /** One index per project root, keyed by `root.toString()`. */
  private static readonly registry = new Map<string, CodedProjectIndex>();

  /** The shared index for a project root (created on first use). */
  public static for(root: vscode.Uri): CodedProjectIndex {
    const key = root.toString();
    let index = CodedProjectIndex.registry.get(key);
    if (index === undefined) {
      index = new CodedProjectIndex(root);
      CodedProjectIndex.registry.set(key, index);
    }
    return index;
  }

  /** Drops every index and its caches (extension deactivation). */
  public static disposeAll(): void {
    CodedProjectIndex.registry.clear();
  }

  /** Per-file fact cache, keyed by file `uri.toString()`. */
  private readonly fileCache = new Map<string, CachedFileFacts>();
  /** Serializes builds — see the module header. */
  private buildChain: Promise<unknown> = Promise.resolve();

  private constructor(private readonly root: vscode.Uri) {}

  /**
   * Build (or incrementally rebuild) the project call graph.
   *
   * `activeFacts`, when provided, substitute the on-disk facts for
   * `activeDoc` — the dirty buffer is the truth for the file being edited.
   * They are used for this build only and never poison the disk cache.
   */
  public getGraph(
    activeDoc: vscode.TextDocument,
    activeFacts: FileFacts | undefined
  ): Promise<CodedProjectGraph> {
    const run = this.buildChain.then(
      () => this.build(activeDoc, activeFacts),
      () => this.build(activeDoc, activeFacts)
    );
    this.buildChain = run.catch(() => undefined);
    return run;
  }

  private async build(
    activeDoc: vscode.TextDocument,
    activeFacts: FileFacts | undefined
  ): Promise<CodedProjectGraph> {
    const start = nowMs();
    const cold = this.fileCache.size === 0;

    const [info, csFiles, xamlFiles] = await Promise.all([
      readProjectInfo(this.root),
      this.findFiles('**/*.cs'),
      this.findFiles('**/*.xaml')
    ]);

    const activeKey = normalizeForCompare(activeDoc.uri.toString());
    const files: Array<FileFacts & { uri?: string }> = [];
    const seenKeys = new Set<string>();
    let activeSubstituted = false;

    for (const fileUri of csFiles) {
      const cacheKey = fileUri.toString();
      seenKeys.add(cacheKey);
      const relPath = relPathInProject(this.root, fileUri);
      if (activeFacts !== undefined && normalizeForCompare(cacheKey) === activeKey) {
        // Dirty-buffer truth for the document being edited; skip disk
        // entirely (its cache entry, if any, stays keyed to disk state).
        files.push({ ...activeFacts, uri: cacheKey });
        activeSubstituted = true;
        continue;
      }
      const facts = await this.factsFor(fileUri, cacheKey, relPath);
      if (facts !== undefined) {
        files.push({ ...facts, uri: cacheKey });
      }
    }

    // Evict cache entries for deleted (or newly excluded) files.
    for (const key of [...this.fileCache.keys()]) {
      if (!seenKeys.has(key)) {
        this.fileCache.delete(key);
      }
    }

    // The active document may be missing from discovery (e.g. just created
    // and the FS watcher race lost) — its facts are still authoritative.
    if (activeFacts !== undefined && !activeSubstituted) {
      files.push({ ...activeFacts, uri: activeDoc.uri.toString() });
    }

    // Normalized xaml rel paths for the existence probe. Case-insensitive
    // on Windows (NTFS), case-sensitive elsewhere.
    const xamlRelPaths = new Set<string>(
      xamlFiles.map((uri) => normalizeForCompare(relPathInProject(this.root, uri)))
    );

    const graph = assembleGraph({
      projectName: info.name,
      projectRootUri: this.root.toString(),
      entryPointRelPaths: info.entryPointRelPaths,
      files,
      xamlFileExists: (normRelPath) => xamlRelPaths.has(normalizeForCompare(normRelPath)),
      // Windows/NTFS: fold case when matching project.json entry-point paths to
      // disk, consistent with the xaml probe above.
      pathsCaseInsensitive: process.platform === 'win32'
    });
    graph.buildMs = Math.round(nowMs() - start);
    logInfo(
      `[coded-graph] build ${cold ? 'cold' : 'warm'} ${files.length} files in ${graph.buildMs} ms`
    );
    return graph;
  }

  private findFiles(includeGlob: string): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles(
      new vscode.RelativePattern(this.root, includeGlob),
      new vscode.RelativePattern(this.root, EXCLUDE_GLOB)
    );
  }

  /**
   * Facts for one on-disk file: served from the cache when the source content
   * fingerprint is unchanged, otherwise re-read and re-parsed. Returns
   * `undefined` when the file vanished or could not be read (it simply drops
   * out of this build).
   *
   * The file is read on every call so the cache is validated against actual
   * content, not just `mtime`/`size` — those can collide (a same-length edit,
   * or a git checkout restoring both) and would serve stale facts. Reading is
   * cheap relative to the tree-sitter parse the fingerprint match lets us skip,
   * so only a genuine content change pays for a re-parse.
   */
  private async factsFor(
    fileUri: vscode.Uri,
    cacheKey: string,
    relPath: string
  ): Promise<FileFacts | undefined> {
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(fileUri);
    } catch {
      this.fileCache.delete(cacheKey);
      return undefined;
    }

    let source: string;
    try {
      source = stripBom(new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(fileUri)));
    } catch (e) {
      logWarn(
        `[coded-graph] could not read ${relPath}: ${e instanceof Error ? e.message : String(e)}`
      );
      this.fileCache.delete(cacheKey);
      return undefined;
    }

    const hash = fingerprint(source);
    const cached = this.fileCache.get(cacheKey);
    if (
      cached !== undefined &&
      cached.hash === hash &&
      cached.mtimeMs === stat.mtime &&
      cached.size === stat.size
    ) {
      return cached.facts;
    }

    const handle = await getCSharpParser();
    const tree = handle.parse(source);
    let facts: FileFacts;
    try {
      // Files with parse errors are still used — `parseHadErrors` flows into
      // the facts and surfaces as `stale` nodes (R8 error tolerance).
      facts = extractFileFacts(relPath, source, tree);
    } finally {
      tree.delete();
    }
    this.fileCache.set(cacheKey, { mtimeMs: stat.mtime, size: stat.size, hash, facts });
    return facts;
  }
}
