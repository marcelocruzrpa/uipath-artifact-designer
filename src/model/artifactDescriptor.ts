/**
 * The contract one artifact kind must satisfy to plug into the designer.
 *
 * Host-side only (imports `vscode`). Interfaces live here, separate from the
 * `registry.ts` value module, so descriptor implementations can import these
 * types without a circular dependency on the registry.
 */
import type * as vscode from 'vscode';
import type { ArtifactKind } from './artifactKind';
import type { ArtifactModel } from './types';
import type { HostToWebview, WebviewToHost } from '../util/messages';

/** A whole-file replacement to apply through a WorkspaceEdit. */
export interface FileEdit {
  uri: vscode.Uri;
  text: string;
}

/** Host capabilities handed to a descriptor when it applies an edit. */
export interface EditContext {
  /** Applies whole-file replacements through a single WorkspaceEdit. */
  applyFileEdits(document: vscode.TextDocument, edits: FileEdit[]): Promise<void>;
  /** Reads and parses a JSON file via the document model (dirty-aware). */
  readJsonDoc(uri: vscode.Uri): Promise<Record<string, unknown> | undefined>;
}

/** Result of a descriptor's content check on a document. */
export type DetectResult =
  | { ok: true }
  | { ok: false; fallback: Extract<HostToWebview, { type: 'fallback' }> };

/** Everything the generic editor provider needs to support one artifact kind. */
export interface ArtifactDescriptor {
  readonly kind: ArtifactKind;
  /** Custom-editor view-type id — must match a package.json customEditors entry. */
  readonly viewType: string;
  /** Sibling-file glob (RelativePattern) whose change should re-render. */
  readonly watchGlobs: string;
  /**
   * Base directory for the sibling-file watcher. Default (member absent or
   * resolves to `undefined`): `uriDirname(document.uri)`.
   */
  watchBase?(document: vscode.TextDocument): Promise<vscode.Uri | undefined> | vscode.Uri | undefined;
  /**
   * Root inside which `openResource` targets are permitted. Default (member
   * absent or resolves to `undefined`): `uriDirname(document.uri)`.
   */
  resourceRoot?(
    document: vscode.TextDocument
  ): Promise<vscode.Uri | undefined> | vscode.Uri | undefined;
  /** Cheap content gate: is this document actually our artifact? */
  detect(document: vscode.TextDocument): DetectResult;
  /** Parse the document (and any sibling files) into the normalized model. */
  loadModel(document: vscode.TextDocument): Promise<ArtifactModel>;
  /** Apply one edit message from the webview back to disk. */
  applyEdit(message: WebviewToHost, document: vscode.TextDocument, ctx: EditContext): Promise<void>;
}
