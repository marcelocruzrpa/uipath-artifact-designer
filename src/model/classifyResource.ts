/**
 * Classifies a parsed `resources/<Name>/resource.json` object into a
 * normalized `ResourceNode`. Pure — no vscode / Node / DOM dependency.
 *
 * Covers the full documented catalog of UiPath low-code agent resources:
 *  - tools: process / agent / api / processOrchestration, integration, internal
 *  - contexts: index, attachments, datafabricentityset
 *  - escalations
 * Anything unrecognized falls back to a generic node so the viewer never
 * silently drops a resource.
 */
import type {
  Badge,
  EscalationChannel,
  Fact,
  JsonSchema,
  NodeGroup,
  NodeKind,
  ResourceNode,
  ToolParameter
} from './types';
import { asArray, asRecord, asString } from '../util/jsonShape';

function titleCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function schemaOf(value: unknown): JsonSchema | undefined {
  return value && typeof value === 'object' ? (value as JsonSchema) : undefined;
}

function describeRecipient(recipient: unknown): string {
  const r = asRecord(recipient);
  return (
    asString(r.displayName) ??
    asString(r.value) ??
    asString(r.argumentName) ??
    asString(r.assetName) ??
    (r.type !== undefined ? `recipient type ${String(r.type)}` : 'recipient')
  );
}

/** Builds the typed escalation channel list. */
function readChannels(raw: Record<string, unknown>): EscalationChannel[] {
  return asArray(raw.channels).map((channel) => {
    const c = asRecord(channel);
    const props = asRecord(c.properties);
    return {
      name: asString(c.name),
      type: asString(c.type),
      appName: asString(props.appName),
      folderName: asString(props.folderName),
      recipients: asArray(c.recipients).map(describeRecipient),
      outcomes: Object.keys(asRecord(c.outcomeMapping))
    };
  });
}

/** Builds the typed tool parameter list (Integration Service tools). */
function readParameters(props: Record<string, unknown>): ToolParameter[] {
  return asArray(props.parameters).map((parameter) => {
    const p = asRecord(parameter);
    return {
      name: asString(p.name) ?? '',
      displayName: asString(p.displayName),
      type: asString(p.type),
      required: p.required === true,
      value: p.value !== undefined ? String(p.value) : undefined,
      description: asString(p.description),
      location: asString(p.fieldLocation),
      variant: asString(p.fieldVariant)
    };
  });
}

interface KindInfo {
  kind: NodeKind;
  group: NodeGroup;
}

function resolveKind(raw: Record<string, unknown>): KindInfo {
  const resourceType = asString(raw.$resourceType);
  if (resourceType === 'tool') {
    const toolType = asString(raw.type);
    if (toolType === 'integration') {
      return { kind: 'tool-integration', group: 'tool' };
    }
    if (toolType === 'internal') {
      return { kind: 'tool-builtin', group: 'tool' };
    }
    if (
      toolType === 'process' ||
      toolType === 'agent' ||
      toolType === 'api' ||
      toolType === 'processOrchestration'
    ) {
      return { kind: 'tool-process', group: 'tool' };
    }
    return { kind: 'tool-unknown', group: 'tool' };
  }
  if (resourceType === 'context') {
    const contextType = asString(raw.contextType);
    if (contextType === 'index') {
      return { kind: 'context-index', group: 'context' };
    }
    if (contextType === 'attachments') {
      return { kind: 'context-attachments', group: 'context' };
    }
    if (contextType === 'datafabricentityset') {
      return { kind: 'context-datafabric', group: 'context' };
    }
    return { kind: 'context-unknown', group: 'context' };
  }
  if (resourceType === 'escalation') {
    return { kind: 'escalation', group: 'escalation' };
  }
  return { kind: 'unknown', group: 'other' };
}

export function classifyResource(
  rawValue: unknown,
  dirName: string,
  sourceUri: string
): ResourceNode {
  const raw = asRecord(rawValue);
  const { kind, group } = resolveKind(raw);
  const props = asRecord(raw.properties);
  const name = asString(raw.name) ?? dirName;
  const description = asString(raw.description) ?? asString(props.toolDescription);

  const badges: Badge[] = [];
  const facts: Fact[] = [];
  let parameters: ToolParameter[] | undefined;
  let channels: EscalationChannel[] | undefined;

  const resourceType = asString(raw.$resourceType);
  facts.push({ label: 'Resource type', value: resourceType ?? 'unknown' });

  switch (kind) {
    case 'tool-integration': {
      const connection = asRecord(props.connection);
      const connector = asRecord(connection.connector);
      const method = asString(props.method);
      const connectionName = asString(connection.name);
      const resolved = !!connectionName && !/^replace-with/i.test(connectionName);
      if (method) {
        badges.push({ label: method.toUpperCase(), tone: 'method' });
      }
      badges.push({ label: 'Integration', tone: 'accent' });
      if (!resolved) {
        badges.push({ label: 'connection not bound', tone: 'warn' });
      }
      facts.push({ label: 'Tool kind', value: 'Integration Service' });
      if (asString(connector.name)) {
        facts.push({ label: 'Connector', value: asString(connector.name) as string });
      }
      if (asString(connector.key)) {
        facts.push({ label: 'Connector key', value: asString(connector.key) as string });
      }
      if (connectionName) {
        facts.push({ label: 'Connection', value: connectionName });
      }
      if (asString(props.toolPath)) {
        facts.push({ label: 'Path', value: asString(props.toolPath) as string });
      }
      parameters = readParameters(props);
      break;
    }
    case 'tool-process': {
      const toolType = asString(raw.type) ?? 'process';
      const location = asString(raw.location);
      badges.push({ label: titleCase(toolType), tone: 'accent' });
      if (location) {
        badges.push({ label: location, tone: 'location' });
      }
      facts.push({ label: 'Tool kind', value: `Process (${toolType})` });
      if (location) {
        facts.push({ label: 'Location', value: location });
      }
      if (asString(props.processName)) {
        facts.push({ label: 'Process', value: asString(props.processName) as string });
      }
      if (asString(props.folderPath)) {
        facts.push({ label: 'Folder', value: asString(props.folderPath) as string });
      }
      break;
    }
    case 'tool-builtin': {
      const toolType = asString(props.toolType) ?? 'internal';
      badges.push({ label: 'Built-in', tone: 'accent' });
      facts.push({ label: 'Tool kind', value: 'Built-in tool' });
      facts.push({ label: 'Built-in type', value: toolType });
      break;
    }
    case 'tool-unknown': {
      badges.push({ label: asString(raw.type) ?? 'tool', tone: 'muted' });
      facts.push({ label: 'Tool kind', value: asString(raw.type) ?? 'unknown' });
      break;
    }
    case 'context-index': {
      const settings = asRecord(raw.settings);
      badges.push({ label: 'Index', tone: 'accent' });
      const retrieval = asString(settings.retrievalMode);
      if (retrieval) {
        badges.push({ label: retrieval, tone: 'muted' });
      }
      facts.push({ label: 'Context kind', value: 'Context Grounding index' });
      if (asString(raw.indexName)) {
        facts.push({ label: 'Index', value: asString(raw.indexName) as string });
      }
      if (asString(raw.folderPath)) {
        facts.push({ label: 'Folder', value: asString(raw.folderPath) as string });
      }
      if (retrieval) {
        facts.push({ label: 'Retrieval mode', value: retrieval });
      }
      if (typeof settings.resultCount === 'number') {
        facts.push({ label: 'Result count', value: String(settings.resultCount) });
      }
      if (typeof settings.threshold === 'number') {
        facts.push({ label: 'Threshold', value: String(settings.threshold) });
      }
      const fileExt = asString(asRecord(settings.fileExtension).value);
      if (fileExt) {
        facts.push({ label: 'File extension', value: fileExt });
      }
      break;
    }
    case 'context-attachments': {
      badges.push({ label: 'Attachments', tone: 'accent' });
      facts.push({ label: 'Context kind', value: 'Runtime attachments' });
      break;
    }
    case 'context-datafabric': {
      badges.push({ label: 'Data Fabric', tone: 'accent' });
      facts.push({ label: 'Context kind', value: 'Data Fabric entity set' });
      for (const entity of asArray(raw.entitySet)) {
        const e = asRecord(entity);
        const entityName = asString(e.name) ?? 'entity';
        const folder = asString(e.folderDisplayName);
        facts.push({ label: 'Entity', value: folder ? `${entityName} (${folder})` : entityName });
      }
      break;
    }
    case 'context-unknown': {
      badges.push({ label: asString(raw.contextType) ?? 'context', tone: 'muted' });
      facts.push({ label: 'Context kind', value: asString(raw.contextType) ?? 'unknown' });
      break;
    }
    case 'escalation': {
      badges.push({ label: 'Escalation', tone: 'accent' });
      channels = readChannels(raw);
      facts.push({ label: 'Channels', value: String(channels.length) });
      if (typeof raw.escalationType === 'number') {
        facts.push({ label: 'Escalation type', value: String(raw.escalationType) });
      }
      for (const channel of channels) {
        const parts = [channel.type ?? 'channel'];
        if (channel.appName) {
          parts.push(channel.appName);
        }
        facts.push({ label: 'Channel', value: parts.join(' · ') });
      }
      break;
    }
    default: {
      badges.push({ label: 'Unknown resource', tone: 'warn' });
      break;
    }
  }

  return {
    id: dirName,
    dirName,
    kind,
    group,
    name,
    description,
    enabled: raw.isEnabled !== false,
    iconUrl: asString(raw.iconUrl),
    sourceUri,
    badges,
    facts,
    inputSchema: schemaOf(raw.inputSchema),
    outputSchema: schemaOf(raw.outputSchema),
    parameters: parameters && parameters.length > 0 ? parameters : undefined,
    channels: channels && channels.length > 0 ? channels : undefined,
    raw: rawValue
  };
}
