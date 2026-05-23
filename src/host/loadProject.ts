/**
 * Reads a full UiPath low-code agent project from disk and builds the
 * normalized `AgentModel` that the webview renders.
 *
 * Lives under `src/host/` because it imports `vscode` and does workspace
 * I/O. The pure model layer in `src/model/` stays free of host APIs so it
 * can be shared with the webview bundle.
 */
import * as vscode from 'vscode';
import { classifyResource } from '../model/classifyResource';
import { clampZoom } from '../model/layout';
import type {
  AgentMessage,
  AgentModel,
  AgentSettings,
  BindingInfo,
  Diagnostic,
  EntryPointInfo,
  EvalSetInfo,
  EvaluatorInfo,
  Fact,
  GuardrailInfo,
  JsonSchema,
  ResourceNode
} from '../model/types';
import { exists, tryReadJson, uriBasename, uriDirname } from '../util/fsHelpers';
import { asArray, asNumber, asRecord, asString } from '../util/jsonShape';

function schemaOf(value: unknown): JsonSchema | undefined {
  return value && typeof value === 'object' ? (value as JsonSchema) : undefined;
}

function readSettings(raw: Record<string, unknown>): AgentSettings {
  const s = asRecord(raw.settings);
  return {
    model: asString(s.model),
    maxTokens: asNumber(s.maxTokens),
    temperature: asNumber(s.temperature),
    engine: asString(s.engine),
    maxIterations: asNumber(s.maxIterations),
    mode: asString(s.mode)
  };
}

function readMessages(raw: Record<string, unknown>): AgentMessage[] {
  return asArray(raw.messages).map((message) => {
    const m = asRecord(message);
    const tokens = asArray(m.contentTokens).map((token) => {
      const t = asRecord(token);
      return { type: asString(t.type) ?? 'simpleText', rawString: asString(t.rawString) ?? '' };
    });
    return {
      role: asString(m.role) ?? 'unknown',
      content: asString(m.content) ?? '',
      contentTokens: tokens
    };
  });
}

const GUARDRAIL_VALIDATOR_LABELS: Record<string, string> = {
  pii_detection: 'PII detection',
  prompt_injection: 'Prompt injection',
  harmful_content: 'Harmful content',
  intellectual_property: 'Intellectual property',
  user_prompt_attacks: 'User prompt attacks'
};

function readGuardrails(raw: Record<string, unknown>): GuardrailInfo[] {
  return asArray(raw.guardrails).map((guardrail, index) => {
    const g = asRecord(guardrail);
    const guardrailType = asString(g.$guardrailType) ?? 'unknown';
    const validatorType = asString(g.validatorType);
    const action = asRecord(g.action);
    const actionType = asString(action.$actionType);
    const selector = asRecord(g.selector);
    const scopes = asArray(selector.scopes).map((s) => String(s));
    const matchNames = asArray(selector.matchNames).map((s) => String(s));
    const name = asString(g.name) ?? `Guardrail ${index + 1}`;

    const facts: Fact[] = [{ label: 'Guardrail type', value: guardrailType }];
    let summary: string;
    if (guardrailType === 'builtInValidator') {
      const label = validatorType
        ? GUARDRAIL_VALIDATOR_LABELS[validatorType] ?? validatorType
        : 'validator';
      summary = label;
      facts.push({ label: 'Validator', value: label });
    } else if (guardrailType === 'custom') {
      const ruleCount = asArray(g.rules).length;
      summary = `Custom · ${ruleCount} rule${ruleCount === 1 ? '' : 's'}`;
      facts.push({ label: 'Rules', value: String(ruleCount) });
    } else {
      summary = guardrailType;
    }
    if (actionType) {
      facts.push({ label: 'Action', value: actionType });
    }
    if (scopes.length > 0) {
      facts.push({ label: 'Scopes', value: scopes.join(', ') });
    }
    if (matchNames.length > 0) {
      facts.push({ label: 'Applies to', value: matchNames.join(', ') });
    }

    return { name, guardrailType, summary, scopes, matchNames, actionType, facts, raw: guardrail };
  });
}

function readEntryPoints(value: unknown): EntryPointInfo[] {
  return asArray(asRecord(value).entryPoints).map((entry) => {
    const e = asRecord(entry);
    return {
      type: asString(e.type) ?? 'agent',
      filePath: asString(e.filePath) ?? '',
      uniqueId: asString(e.uniqueId) ?? ''
    };
  });
}

function readBindings(value: unknown): BindingInfo[] {
  return asArray(asRecord(value).resources).map((binding) => {
    const b = asRecord(binding);
    const v = asRecord(b.value);
    const metadata = asRecord(b.metadata);
    return {
      resource: asString(b.resource) ?? 'resource',
      key: asString(b.key) ?? '',
      name: asString(asRecord(v.name).defaultValue),
      connector: asString(metadata.connector),
      folderPath: asString(asRecord(v.folderPath).defaultValue)
    };
  });
}

function evaluatorTypeLabel(type: unknown): string {
  switch (type) {
    case 1:
      return 'Exact match';
    case 5:
      return 'Semantic similarity';
    case 6:
      return 'JSON similarity';
    case 7:
      return 'Trajectory';
    default:
      return typeof type === 'number' ? `Type ${type}` : 'Unknown';
  }
}

async function readEvals(
  projectDir: vscode.Uri
): Promise<{ evaluators: EvaluatorInfo[]; sets: EvalSetInfo[] }> {
  const evaluators: EvaluatorInfo[] = [];
  const sets: EvalSetInfo[] = [];

  const evaluatorsDir = vscode.Uri.joinPath(projectDir, 'evals', 'evaluators');
  try {
    for (const [entryName, fileType] of await vscode.workspace.fs.readDirectory(evaluatorsDir)) {
      if (fileType !== vscode.FileType.File || !entryName.endsWith('.json')) {
        continue;
      }
      const raw = asRecord(await tryReadJson(vscode.Uri.joinPath(evaluatorsDir, entryName)));
      evaluators.push({
        name: asString(raw.name) ?? entryName,
        type: asNumber(raw.type),
        typeLabel: evaluatorTypeLabel(raw.type)
      });
    }
  } catch {
    /* no evaluators directory */
  }

  const setsDir = vscode.Uri.joinPath(projectDir, 'evals', 'eval-sets');
  try {
    for (const [entryName, fileType] of await vscode.workspace.fs.readDirectory(setsDir)) {
      if (fileType !== vscode.FileType.File || !entryName.endsWith('.json')) {
        continue;
      }
      const raw = asRecord(await tryReadJson(vscode.Uri.joinPath(setsDir, entryName)));
      sets.push({
        name: asString(raw.name) ?? entryName,
        testCaseCount: asArray(raw.evaluations).length,
        evaluatorCount: asArray(raw.evaluatorRefs).length
      });
    }
  } catch {
    /* no eval-sets directory */
  }

  return { evaluators, sets };
}

/** Rank used by `Array.sort` to keep unknown resource groups consistently last. */
const UNKNOWN_GROUP_RANK = Number.MAX_SAFE_INTEGER;

const GROUP_RANK: Record<string, number> = {
  context: 0,
  tool: 1,
  escalation: 2,
  memory: 3,
  other: 4
};

/**
 * Builds the synthetic "Agent memory" node. Memory is an intrinsic agent
 * capability (not a `resources/` resource), so the node is always present and
 * reflects the `metadata.agentMemory` flag from agent.json.
 */
function buildMemoryNode(raw: Record<string, unknown>): ResourceNode {
  const metadata = asRecord(raw.metadata);
  const memRaw = metadata.agentMemory ?? raw.agentMemory;
  const settings =
    typeof memRaw === 'object' && memRaw !== null ? (memRaw as Record<string, unknown>) : {};
  const enabled = memRaw === true || Object.keys(settings).length > 0;

  const facts: Fact[] = [
    { label: 'Capability', value: 'Conversation memory' },
    { label: 'State', value: enabled ? 'Enabled' : 'Disabled' }
  ];
  for (const [key, value] of Object.entries(settings)) {
    facts.push({
      label: key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value)
    });
  }

  return {
    id: 'agent-memory',
    dirName: 'agent-memory',
    kind: 'memory',
    group: 'memory',
    name: 'Agent memory',
    description:
      'Conversation memory lets the agent recall earlier turns of the same conversation.',
    enabled: true,
    badges: [
      enabled ? { label: 'Enabled', tone: 'accent' } : { label: 'Disabled', tone: 'muted' }
    ],
    facts,
    raw: { agentMemory: enabled, ...settings }
  };
}

async function readResources(
  projectDir: vscode.Uri,
  diagnostics: Diagnostic[]
): Promise<ResourceNode[]> {
  const resources: ResourceNode[] = [];
  const resourcesDir = vscode.Uri.joinPath(projectDir, 'resources');
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(resourcesDir);
  } catch {
    return resources;
  }

  for (const [entryName, fileType] of entries) {
    if (fileType !== vscode.FileType.Directory) {
      continue;
    }
    const resourceUri = vscode.Uri.joinPath(resourcesDir, entryName, 'resource.json');
    const raw = await tryReadJson(resourceUri);
    if (raw === undefined) {
      diagnostics.push({
        severity: 'warning',
        message: `resources/${entryName}/resource.json is missing or contains invalid JSON.`
      });
      continue;
    }
    const node = classifyResource(raw, entryName, resourceUri.toString());
    resources.push(node);
    if (node.kind === 'unknown' || node.kind.endsWith('-unknown')) {
      diagnostics.push({
        severity: 'info',
        message: `Resource "${node.name}" has an unrecognized type and is shown as a generic node.`
      });
    }
  }

  resources.sort((a, b) => {
    const rank =
      (GROUP_RANK[a.group] ?? UNKNOWN_GROUP_RANK) - (GROUP_RANK[b.group] ?? UNKNOWN_GROUP_RANK);
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });
  return resources;
}

/**
 * Builds the full agent model. `agentJson` is the already-parsed agent.json
 * (the caller has confirmed it is a low-code agent).
 */
export async function loadProject(
  document: vscode.TextDocument,
  agentJson: unknown
): Promise<AgentModel> {
  const raw = asRecord(agentJson);
  const projectDir = uriDirname(document.uri);
  const diagnostics: Diagnostic[] = [];

  const isArtifactCopy = uriBasename(projectDir).toLowerCase() === '.agent-builder';

  const projectUiproj = asRecord(
    await tryReadJson(vscode.Uri.joinPath(projectDir, 'project.uiproj'))
  );
  const entryPointsJson = await tryReadJson(vscode.Uri.joinPath(projectDir, 'entry-points.json'));
  const bindingsJson = await tryReadJson(vscode.Uri.joinPath(projectDir, 'bindings_v2.json'));
  const flowLayout = asRecord(
    await tryReadJson(vscode.Uri.joinPath(projectDir, 'flow-layout.json'))
  );

  const hasProjectUiproj = await exists(vscode.Uri.joinPath(projectDir, 'project.uiproj'));
  const hasEntryPoints = await exists(vscode.Uri.joinPath(projectDir, 'entry-points.json'));
  const isInlineInFlow = !hasProjectUiproj && !hasEntryPoints;

  if (!isInlineInFlow && !isArtifactCopy) {
    if (!hasEntryPoints) {
      diagnostics.push({ severity: 'warning', message: 'entry-points.json was not found.' });
    }
    if (!hasProjectUiproj) {
      diagnostics.push({ severity: 'warning', message: 'project.uiproj was not found.' });
    }
  }

  const resources = await readResources(projectDir, diagnostics);
  resources.push(buildMemoryNode(raw));
  const evals = await readEvals(projectDir);

  const projectName = asString(projectUiproj.Name) ?? uriBasename(projectDir) ?? 'UiPath Agent';
  const initialZoom = clampZoom(asNumber(flowLayout.zoom) ?? 1);

  return {
    kind: 'agent',
    title: projectName,
    subtitle: 'UiPath Agent',
    schemaOk: true,
    isArtifactCopy,
    isInlineInFlow,
    version: asString(raw.version),
    projectId: asString(raw.projectId),
    projectName,
    projectDescription: asString(projectUiproj.Description),
    settings: readSettings(raw),
    metadata: asRecord(raw.metadata),
    messages: readMessages(raw),
    inputSchema: schemaOf(raw.inputSchema),
    outputSchema: schemaOf(raw.outputSchema),
    guardrails: readGuardrails(raw),
    resources,
    entryPoints: readEntryPoints(entryPointsJson),
    bindings: readBindings(bindingsJson),
    evals,
    initialZoom,
    diagnostics
  };
}
