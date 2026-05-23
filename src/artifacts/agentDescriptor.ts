/**
 * Artifact descriptor for UiPath low-code agents (`agent.json`).
 *
 * This is the registry entry that reproduces the original single-artifact
 * behavior of the extension — detection, model loading and edit-apply are the
 * exact logic that previously lived inline in `agentEditorProvider.ts`.
 */
import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type {
  ArtifactDescriptor,
  DetectResult,
  EditContext,
  FileEdit
} from '../model/artifactDescriptor';
import type { ArtifactModel } from '../model/types';
import { applyArgumentsToSchema, applyPrompt, serializeJson, setByPath } from '../model/editAgent';
import { loadProject } from '../host/loadProject';
import { isLowCodeAgent, parseJsonLoose } from '../model/parseAgent';
import { isInside, uriBasename, uriDirname } from '../util/fsHelpers';
import type { WebviewToHost } from '../util/messages';
import { logError } from '../util/log';

function detectAgent(document: vscode.TextDocument): DetectResult {
  const parsed = parseJsonLoose(document.getText());
  if (parsed.error) {
    return {
      ok: false,
      fallback: { type: 'fallback', kind: 'parse-error', message: parsed.error }
    };
  }
  if (uriBasename(uriDirname(document.uri)).toLowerCase() === '.agent-builder') {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'artifact',
        message:
          'This agent.json lives in .agent-builder/ — a generated build artifact. ' +
          'Open the project’s top-level agent.json to use the designer.'
      }
    };
  }
  if (!isLowCodeAgent(parsed.json)) {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'not-agent',
        message: 'This file is not a UiPath low-code agent (missing "type": "lowCode").'
      }
    };
  }
  return { ok: true };
}

async function loadAgentModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const parsed = parseJsonLoose(document.getText());
  return loadProject(document, parsed.json);
}

/** Mirrors an argument edit into entry-points.json, when that file exists. */
async function collectEntryPointEdit(
  document: vscode.TextDocument,
  message: Extract<WebviewToHost, { type: 'editArguments' }>,
  edits: FileEdit[],
  ctx: EditContext
): Promise<void> {
  const uri = vscode.Uri.joinPath(uriDirname(document.uri), 'entry-points.json');
  const json = await ctx.readJsonDoc(uri);
  if (!json) {
    return;
  }
  const entryPoints = json.entryPoints;
  if (!Array.isArray(entryPoints) || !entryPoints[0] || typeof entryPoints[0] !== 'object') {
    return;
  }
  const entryPoint = entryPoints[0] as Record<string, unknown>;
  const key = message.direction === 'input' ? 'input' : 'output';
  entryPoint[key] = applyArgumentsToSchema(entryPoint[key], message.properties, message.required);
  edits.push({ uri, text: serializeJson(json) });
}

/** Applies a single edit message back to the agent's JSON file(s). */
async function applyAgentEdit(
  message: WebviewToHost,
  document: vscode.TextDocument,
  ctx: EditContext
): Promise<void> {
  try {
    if (
      message.type === 'editAgentField' ||
      message.type === 'editAgentPrompt' ||
      message.type === 'editArguments'
    ) {
      const parsed = parseJsonLoose(document.getText());
      if (parsed.error || !parsed.json || typeof parsed.json !== 'object') {
        void vscode.window.showWarningMessage(
          'UiPath Artifact Designer: cannot edit — agent.json has invalid JSON.'
        );
        return;
      }
      const json = parsed.json as Record<string, unknown>;
      const edits: FileEdit[] = [];
      if (message.type === 'editAgentField') {
        setByPath(json, message.path, message.value);
      } else if (message.type === 'editAgentPrompt') {
        applyPrompt(json, message.role, message.content);
      } else {
        const key = message.direction === 'input' ? 'inputSchema' : 'outputSchema';
        json[key] = applyArgumentsToSchema(json[key], message.properties, message.required);
        await collectEntryPointEdit(document, message, edits, ctx);
      }
      edits.unshift({ uri: document.uri, text: serializeJson(json) });
      await ctx.applyFileEdits(document, edits);
      return;
    }

    if (message.type === 'editProject') {
      const uri = vscode.Uri.joinPath(uriDirname(document.uri), 'project.uiproj');
      const json = await ctx.readJsonDoc(uri);
      if (!json) {
        void vscode.window.showWarningMessage(
          'UiPath Artifact Designer: project.uiproj not found — cannot edit name/description.'
        );
        return;
      }
      json[message.field] = message.value;
      await ctx.applyFileEdits(document, [{ uri, text: serializeJson(json) }]);
      return;
    }

    if (message.type === 'editResourceField') {
      const uri = vscode.Uri.parse(message.uri, true);
      if (uri.scheme !== document.uri.scheme || !isInside(uriDirname(document.uri), uri)) {
        void vscode.window.showWarningMessage(
          'UiPath Artifact Designer: refused to edit a file outside the agent project.'
        );
        return;
      }
      const json = await ctx.readJsonDoc(uri);
      if (!json) {
        return;
      }
      setByPath(json, message.path, message.value);
      await ctx.applyFileEdits(document, [{ uri, text: serializeJson(json) }]);
      return;
    }
  } catch (e) {
    logError('agent edit failed', e);
    void vscode.window.showErrorMessage(
      `UiPath Artifact Designer: edit failed — ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export const agentDescriptor: ArtifactDescriptor = {
  kind: 'agent',
  viewType: VIEW_TYPES.agent,
  watchGlobs: '{entry-points.json,bindings_v2.json,project.uiproj,flow-layout.json,resources/**,evals/**}',
  detect: detectAgent,
  loadModel: loadAgentModel,
  applyEdit: applyAgentEdit
};
