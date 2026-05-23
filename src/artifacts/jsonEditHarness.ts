/**
 * Shared edit harness for the JSON-document artifact descriptors (Maestro Flow,
 * Maestro Case, Coded App).
 *
 * Each of those descriptors previously copy-pasted the same wrapper around its
 * edit logic: parse the document, guard invalid JSON, run a mutator, serialize
 * and apply through one WorkspaceEdit, and report failures. Centralizing that
 * wrapper here keeps the boilerplate from drifting between the three.
 */
import * as vscode from 'vscode';
import type { EditContext } from '../model/artifactDescriptor';
import { serializeJson } from '../model/editAgent';
import { parseJsonLoose } from '../model/parseAgent';
import { logError } from '../util/log';
import { isRecord } from '../util/objects';

/**
 * Parses `document` as JSON, runs `mutate` on the parsed object, and — when the
 * mutator reports a change — serializes and writes the result through a single
 * WorkspaceEdit.
 *
 * @param invalidJsonMessage Warning shown when the document is not valid JSON.
 * @param editKind           Short label used in the diagnostic log on failure.
 * @param mutate             Pure mutator; MUST return `true` only when it
 *                           actually changed `json`.
 */
export async function applyJsonDocumentEdit(
  document: vscode.TextDocument,
  ctx: EditContext,
  invalidJsonMessage: string,
  editKind: string,
  mutate: (json: Record<string, unknown>) => boolean
): Promise<void> {
  try {
    const parsed = parseJsonLoose(document.getText());
    if (parsed.error || !isRecord(parsed.json)) {
      void vscode.window.showWarningMessage(invalidJsonMessage);
      return;
    }
    const json = parsed.json;
    if (!mutate(json)) {
      return;
    }
    await ctx.applyFileEdits(document, [{ uri: document.uri, text: serializeJson(json) }]);
  } catch (e) {
    logError(`${editKind} edit failed`, e);
    void vscode.window.showErrorMessage(
      `UiPath Designer: edit failed — ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
