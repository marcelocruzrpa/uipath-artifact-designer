/**
 * HOST-SIDE project discovery for the coded-workflow call graph (T2.2).
 *
 * A coded workflow lives somewhere inside a UiPath Studio project whose root
 * is marked by a `project.json`. `findProjectRoot` walks UP from the
 * document's directory to the nearest such root; `readProjectInfo` parses the
 * manifest loosely (the pure rules live in
 * `src/model/codedWorkflow/projectInfo.ts`).
 *
 * Host-only module — imports `vscode`; never bundled into the webview.
 */
import * as vscode from 'vscode';
import { parseProjectJson } from '../model/codedWorkflow/projectInfo';
import { exists, tryReadJson, uriBasename, uriDirname } from '../util/fsHelpers';

/**
 * Upper bound on the upward walk when the document is OUTSIDE every
 * workspace folder. Inside a workspace folder the folder root is the bound
 * (inclusive), so this only guards loose files opened from anywhere on disk.
 */
const MAX_WALK_LEVELS_OUTSIDE_WORKSPACE = 12;

/** Project facts the graph index needs from one `project.json`. */
export interface CodedProjectInfo {
  rootUri: vscode.Uri;
  name: string;
  /** Normalized (forward-slash) rel paths of `.cs` entry points; may be empty. */
  entryPointRelPaths: Set<string>;
}

/**
 * Find the nearest ancestor directory of `docUri` containing a
 * `project.json` — the UiPath project root. Walks up from the file's own
 * directory, stopping at (and including) the containing workspace-folder
 * root; outside a workspace folder the walk is bounded to
 * {@link MAX_WALK_LEVELS_OUTSIDE_WORKSPACE} levels. Returns `undefined` when
 * no root is found.
 */
export async function findProjectRoot(docUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri);
  let dir = uriDirname(docUri);
  for (let level = 0; ; level++) {
    if (await exists(vscode.Uri.joinPath(dir, 'project.json'))) {
      return dir;
    }
    if (workspaceFolder !== undefined) {
      // Bounded by the workspace folder (checked above, so inclusive).
      if (dir.toString() === workspaceFolder.uri.toString()) {
        return undefined;
      }
    } else if (level >= MAX_WALK_LEVELS_OUTSIDE_WORKSPACE) {
      return undefined;
    }
    const parent = uriDirname(dir);
    if (parent.toString() === dir.toString()) {
      // Filesystem root.
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Read and loosely parse `<rootUri>/project.json`. Never throws: a missing
 * or malformed manifest yields the directory basename as the project name
 * and an empty entry-point set.
 */
export async function readProjectInfo(rootUri: vscode.Uri): Promise<CodedProjectInfo> {
  const fallbackName = uriBasename(rootUri) || 'Coded Project';
  const json = await tryReadJson(vscode.Uri.joinPath(rootUri, 'project.json'));
  const facts = parseProjectJson(json, fallbackName);
  return { rootUri, name: facts.name, entryPointRelPaths: facts.entryPointRelPaths };
}

/**
 * Path of `file` relative to `root`, forward-slash separated. Falls back to
 * the file's basename when `file` is not under `root` (defensive — callers
 * only pass files discovered under the root).
 */
export function relPathInProject(root: vscode.Uri, file: vscode.Uri): string {
  const rootPath = root.path.endsWith('/') ? root.path : root.path + '/';
  if (file.path.startsWith(rootPath)) {
    return file.path.slice(rootPath.length);
  }
  // Windows drive letters can differ in case between URIs from different
  // VS Code APIs; retry case-insensitively before giving up.
  if (file.path.toLowerCase().startsWith(rootPath.toLowerCase())) {
    return file.path.slice(rootPath.length);
  }
  return uriBasename(file);
}
