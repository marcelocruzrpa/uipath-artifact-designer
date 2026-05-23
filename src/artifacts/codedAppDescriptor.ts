/**
 * Artifact descriptor for UiPath Coded Apps. The custom editor is registered
 * for `action-schema.json` (the authored data contract); the sibling
 * `.uipath/app.config.json` is publish-generated deployment metadata and is
 * surfaced read-only.
 */
import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult, EditContext } from '../model/artifactDescriptor';
import { buildSectionProperties, parseActionSchema } from '../model/codedApp/parseCodedApp';
import { parseJsonLoose } from '../model/parseAgent';
import type { ArtifactModel, CodedAppModel, Fact } from '../model/types';
import { tryReadJson, uriBasename, uriDirname } from '../util/fsHelpers';
import { isRecord } from '../util/objects';
import type { WebviewToHost } from '../util/messages';
import { applyJsonDocumentEdit } from './jsonEditHarness';

function detectCodedApp(document: vscode.TextDocument): DetectResult {
  const parsed = parseJsonLoose(document.getText());
  if (parsed.error) {
    return {
      ok: false,
      fallback: { type: 'fallback', kind: 'parse-error', message: parsed.error }
    };
  }
  const json = parsed.json;
  if (
    !isRecord(json) ||
    !isRecord(json.inputs) ||
    !isRecord(json.outputs) ||
    !isRecord(json.inOuts) ||
    !isRecord(json.outcomes)
  ) {
    return {
      ok: false,
      fallback: {
        type: 'fallback',
        kind: 'not-coded-app',
        message:
          'This action-schema.json is missing one or more of the required ' +
          'inputs, outputs, inOuts and outcomes sections.'
      }
    };
  }
  return { ok: true };
}

const CONFIG_FACT_LABELS: Record<string, string> = {
  appName: 'App name',
  appVersion: 'Version',
  systemName: 'System name',
  appType: 'App type',
  appUrl: 'App URL',
  deploymentId: 'Deployment id',
  registeredAt: 'Registered',
  deployedAt: 'Deployed'
};

async function loadCodedAppModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const parsed = parseJsonLoose(document.getText());
  const actionSchema = parseActionSchema(parsed.json);

  const projectDir = uriDirname(document.uri);
  const configRaw = await tryReadJson(
    vscode.Uri.joinPath(projectDir, '.uipath', 'app.config.json')
  );

  const config: Fact[] = [];
  if (isRecord(configRaw)) {
    for (const [key, value] of Object.entries(configRaw)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      config.push({ label: CONFIG_FACT_LABELS[key] ?? key, value: String(value) });
    }
  }

  const appName =
    isRecord(configRaw) && typeof configRaw.appName === 'string' ? configRaw.appName : undefined;

  const model: CodedAppModel = {
    kind: 'coded-app',
    title: appName ?? uriBasename(projectDir) ?? 'Coded App',
    subtitle: 'Coded App',
    diagnostics: [],
    schemaOk: true,
    config,
    hasConfig: config.length > 0,
    actionSchema
  };
  return model;
}

async function applyCodedAppEdit(
  message: WebviewToHost,
  document: vscode.TextDocument,
  ctx: EditContext
): Promise<void> {
  if (message.type !== 'setActionSchemaSection') {
    return;
  }
  await applyJsonDocumentEdit(
    document,
    ctx,
    'UiPath Designer: cannot edit — action-schema.json has invalid JSON.',
    'coded-app',
    (json) => {
      const existing = isRecord(json[message.section])
        ? (json[message.section] as Record<string, unknown>)
        : {};
      const existingProps = isRecord(existing.properties) ? existing.properties : {};
      existing.type = 'object';
      existing.properties = buildSectionProperties(message.fields, existingProps);
      json[message.section] = existing;
      return true;
    }
  );
}

export const codedAppDescriptor: ArtifactDescriptor = {
  kind: 'coded-app',
  viewType: VIEW_TYPES['coded-app'],
  watchGlobs: '{action-schema.json,.uipath/app.config.json}',
  detect: detectCodedApp,
  loadModel: loadCodedAppModel,
  applyEdit: applyCodedAppEdit
};
