import * as vscode from 'vscode';

/** Returns the parent directory of a URI. */
export function uriDirname(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..');
}

/** Returns the last path segment of a URI (file or directory name). */
export function uriBasename(uri: vscode.Uri): string {
  const segments = uri.path.split('/').filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/** Strips a leading UTF-8 BOM, if present. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Upper bound on file size for {@link tryReadJson}. Resource manifests, eval
 * sets, and bindings files are real-world <100 KB; 5 MB leaves ~50× headroom
 * while keeping a pathological artifact from forcing a multi-hundred-MB
 * `JSON.parse` allocation in the extension host.
 */
const TRY_READ_JSON_MAX_BYTES = 5_000_000;

/**
 * Reads and parses a JSON file via the text-document model, so unsaved (dirty)
 * edits are reflected. Returns `undefined` on any failure — never throws.
 * Files larger than {@link TRY_READ_JSON_MAX_BYTES} are skipped to bound the
 * extension host's memory footprint when opening hostile workspaces.
 */
export async function tryReadJson(uri: vscode.Uri): Promise<unknown | undefined> {
  try {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > TRY_READ_JSON_MAX_BYTES) {
        return undefined;
      }
    } catch {
      // Stat failure usually means the file does not exist; let
      // openTextDocument below report the same way (returning undefined).
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return JSON.parse(stripBom(doc.getText()));
  } catch {
    return undefined;
  }
}

/** Returns true if a file or directory exists at the URI. */
export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URI path for prefix comparison. Splits on `/`, drops empty /
 * `.` segments, and rejects any path containing a `..` segment so traversal
 * sequences cannot pass a literal prefix check. File-scheme paths are
 * lowercased on Windows (`process.platform === 'win32'`) because NTFS is
 * case-insensitive — a guard that is case-sensitive there is unsound.
 *
 * Returns `null` when the path contains `..`, which {@link isInside} treats
 * as a containment failure.
 */
function normalizeUriPathForCompare(uri: vscode.Uri): string | null {
  const segments = uri.path.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) {
    return null;
  }
  const joined = '/' + segments.join('/');
  return uri.scheme === 'file' && process.platform === 'win32' ? joined.toLowerCase() : joined;
}

/**
 * Returns true when `child` is the same as, or nested inside, `parent`.
 * Rejects URIs whose path contains `..` (a path-traversal indicator) and
 * compares case-insensitively on Windows for file-scheme URIs (NTFS is
 * case-insensitive — a case-sensitive guard would be unsound there).
 *
 * Note: this is a PURE lexical check — it does not resolve symlinks (this
 * module is bundled into the webview, so it cannot import `fs`). A symlink
 * inside `parent` pointing outside would pass here. WRITE sinks must therefore
 * layer a real-path/symlink gate on top in the host (see
 * `ArtifactEditorProvider.isSafeWriteTarget`); this function stays the cheap
 * first-pass containment check.
 */
export function isInside(parent: vscode.Uri, child: vscode.Uri): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const np = normalizeUriPathForCompare(parent);
  const nc = normalizeUriPathForCompare(child);
  if (np === null || nc === null) {
    return false;
  }
  if (nc === np) {
    return true;
  }
  const base = np.endsWith('/') ? np : np + '/';
  return nc.startsWith(base);
}
