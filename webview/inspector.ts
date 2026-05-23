/** The right-side detail panel — an editable property form for the selected node. */
import type {
  AgentModel,
  EscalationChannel,
  GuardrailInfo,
  ResourceNode,
  ToolParameter
} from '../src/model/types';
import type { EditValue, WebviewToHost } from '../src/util/messages';
import { clearChildren, deepEqual, el, factList, section } from './util';
import { renderArgumentsEditor } from './components/argumentsEditor';
import { renderEvals } from './components/evalsPanel';
import {
  checkboxField,
  comboField,
  field,
  numberField,
  selectField,
  textArea,
  textField
} from './components/formControls';
import { nodeIcon } from './components/icons';
import { kindLabel } from './components/nodeCard';
import { renderSchema } from './components/schemaTree';

type Post = (message: WebviewToHost) => void;

// TODO(post-1.0): these literal lists drift with the LLM Gateway catalog
// every few months. Move to a host-fetched config or shared constants file
// when the next stale-list user report comes in. For now, hand-edit at
// release time.
const KNOWN_MODELS = [
  'anthropic.claude-sonnet-4-6',
  'gpt-4.1-2025-04-14',
  'gpt-5.2-2025-12-11',
  'gpt-4o-2024-11-20',
  'anthropic.claude-haiku-4-5'
];

const RETRIEVAL_MODES = ['semantic', 'structured', 'deeprag', 'batchtransform'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function linkButton(label: string, onClick: () => void): HTMLElement {
  const button = el('button', { class: 'link-btn', text: label });
  button.addEventListener('click', onClick);
  return button;
}

function headerBlock(kind: string, title: string, subtitle: string): HTMLElement {
  const icon = el('div', { class: 'inspector-icon' });
  icon.dataset.kind = kind;
  icon.append(nodeIcon(kind as never));
  return el('div', { class: 'inspector-header' }, [
    icon,
    el('div', { class: 'inspector-titles' }, [
      el('div', { class: 'inspector-title', text: title, title }),
      el('div', { class: 'inspector-subtitle', text: subtitle })
    ])
  ]);
}

function guardrailBlock(guardrail: GuardrailInfo): HTMLElement {
  return el('div', { class: 'sub-block' }, [
    el('div', { class: 'sub-title', text: guardrail.name }),
    el('div', { class: 'sub-meta', text: guardrail.summary }),
    factList(guardrail.facts)
  ]);
}

function channelBlock(channel: EscalationChannel): HTMLElement {
  const facts: Array<{ label: string; value: string }> = [];
  if (channel.type) {
    facts.push({ label: 'Type', value: channel.type });
  }
  if (channel.appName) {
    facts.push({ label: 'App', value: channel.appName });
  }
  if (channel.folderName) {
    facts.push({ label: 'Folder', value: channel.folderName });
  }
  if (channel.recipients.length > 0) {
    facts.push({ label: 'Recipients', value: channel.recipients.join(', ') });
  }
  if (channel.outcomes.length > 0) {
    facts.push({ label: 'Outcomes', value: channel.outcomes.join(', ') });
  }
  return el('div', { class: 'sub-block' }, [
    el('div', { class: 'sub-title', text: channel.name ?? channel.type ?? 'Channel' }),
    factList(facts)
  ]);
}

function parametersTable(parameters: ToolParameter[]): HTMLElement {
  const rows: HTMLElement[] = [
    el('tr', {}, [
      el('th', { text: 'Name' }),
      el('th', { text: 'Type' }),
      el('th', { text: 'Required' }),
      el('th', { text: 'Value' })
    ])
  ];
  for (const parameter of parameters) {
    rows.push(
      el('tr', {}, [
        el('td', { text: parameter.displayName ?? parameter.name }),
        el('td', { text: parameter.type ?? '—' }),
        el('td', { text: parameter.required ? 'yes' : 'no' }),
        el('td', { text: parameter.value ?? '—' })
      ])
    );
  }
  return el('table', { class: 'param-table' }, rows);
}

function rawBlock(label: string, value: unknown): HTMLElement {
  const details = el('details', { class: 'raw-block' });
  details.append(el('summary', { text: label }));
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  details.append(el('pre', { class: 'raw-json', text }));
  return details;
}

/** Identifies what the inspector last rendered, for the redundant-render check. */
type InspectorState =
  | { view: 'empty' }
  | { view: 'agent'; model: AgentModel }
  | { view: 'resource'; node: ResourceNode };

export class Inspector {
  private readonly root: HTMLElement;
  /** What the panel currently shows — used to skip identical re-renders. */
  private rendered: InspectorState | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly post: Post
  ) {
    this.root = el('div', { class: 'inspector-body' });
    host.append(this.root);
    this.showEmpty();
  }

  /** Rebuilds the panel, preserving the scroll position across the re-render. */
  private rebuild(build: () => void): void {
    const scroll = this.host.scrollTop;
    clearChildren(this.root);
    build();
    this.host.scrollTop = scroll;
  }

  showEmpty(): void {
    if (this.rendered?.view === 'empty') {
      return;
    }
    this.rendered = { view: 'empty' };
    this.rebuild(() => {
      this.root.append(
        el('div', {
          class: 'inspector-empty',
          text: 'Select the agent or a resource node to view and edit its details.'
        })
      );
    });
  }

  showAgent(model: AgentModel): void {
    // Dirty check: skip the teardown when the same agent data is already shown.
    if (this.rendered?.view === 'agent' && deepEqual(this.rendered.model, model)) {
      return;
    }
    this.rendered = { view: 'agent', model };
    this.rebuild(() => this.renderAgent(model));
  }

  showResource(node: ResourceNode): void {
    if (this.rendered?.view === 'resource' && deepEqual(this.rendered.node, node)) {
      return;
    }
    this.rendered = { view: 'resource', node };
    this.rebuild(() => this.renderResource(node));
  }

  private renderAgent(model: AgentModel): void {
    this.root.append(headerBlock('agent', model.projectName, 'Low-code agent'));

    // Project (name / description) — project.uiproj only exists for standalone agents.
    if (model.isInlineInFlow) {
      this.root.append(el('div', { class: 'inline-note', text: 'Inline-in-flow agent.' }));
    } else {
      const project = el('div', {});
      project.append(
        field(
          'Name',
          textField(model.projectName, (v) =>
            this.post({ type: 'editProject', field: 'Name', value: v })
          )
        )
      );
      project.append(
        field(
          'Description',
          textArea(model.projectDescription ?? '', 2, (v) =>
            this.post({ type: 'editProject', field: 'Description', value: v })
          )
        )
      );
      this.root.append(section('Project', project));
    }

    // Settings.
    const s = model.settings;
    const settings = el('div', {});
    settings.append(
      field(
        'Model',
        comboField(s.model ?? '', 'model-suggestions', KNOWN_MODELS, (v) =>
          this.editAgent(['settings', 'model'], v)
        )
      )
    );
    settings.append(
      field(
        'Temperature',
        numberField(s.temperature, { min: 0, max: 2, step: 0.1 }, (v) =>
          this.editAgent(['settings', 'temperature'], v)
        )
      )
    );
    settings.append(
      field(
        'Max tokens',
        numberField(s.maxTokens, { min: 1, step: 1 }, (v) =>
          this.editAgent(['settings', 'maxTokens'], v)
        )
      )
    );
    settings.append(
      field(
        'Max iterations',
        numberField(s.maxIterations, { min: 1, step: 1 }, (v) =>
          this.editAgent(['settings', 'maxIterations'], v)
        )
      )
    );
    const fixed: Array<{ label: string; value: string }> = [];
    if (s.engine) {
      fixed.push({ label: 'Engine', value: s.engine });
    }
    if (s.mode) {
      fixed.push({ label: 'Mode', value: s.mode });
    }
    if (fixed.length > 0) {
      settings.append(factList(fixed));
    }
    this.root.append(section('Settings', settings));

    // Prompts.
    const systemMessage = model.messages.find((m) => m.role === 'system');
    const userMessage = model.messages.find((m) => m.role === 'user');
    this.root.append(
      section(
        'System prompt',
        textArea(systemMessage?.content ?? '', 8, (v) =>
          this.post({ type: 'editAgentPrompt', role: 'system', content: v })
        )
      )
    );
    this.root.append(
      section(
        'User prompt',
        textArea(userMessage?.content ?? '', 5, (v) =>
          this.post({ type: 'editAgentPrompt', role: 'user', content: v })
        ),
        el('div', {
          class: 'field-hint',
          text: 'Use {{input.fieldName}} to insert an argument.'
        })
      )
    );

    // Arguments.
    this.root.append(
      section(
        'Input arguments',
        renderArgumentsEditor(model.inputSchema, (properties, required) =>
          this.post({ type: 'editArguments', direction: 'input', properties, required })
        ),
        el('p', {
          class: 'muted-note',
          text: 'Renaming or removing an argument does not update {{input.x}} in the prompt.'
        })
      )
    );
    this.root.append(
      section(
        'Output arguments',
        renderArgumentsEditor(model.outputSchema, (properties, required) =>
          this.post({ type: 'editArguments', direction: 'output', properties, required })
        )
      )
    );

    // Read-only sections.
    const guardrails = el('div', {});
    if (model.guardrails.length === 0) {
      guardrails.append(el('p', { class: 'muted-note', text: 'No guardrails configured.' }));
    } else {
      for (const guardrail of model.guardrails) {
        guardrails.append(guardrailBlock(guardrail));
      }
    }
    this.root.append(section('Guardrails', guardrails));

    if (model.entryPoints.length > 0) {
      this.root.append(
        section(
          'Entry points',
          factList(model.entryPoints.map((e) => ({ label: e.type, value: e.filePath })))
        )
      );
    }
    this.root.append(section('Evaluations', renderEvals(model.evals)));

    const meta: Array<{ label: string; value: string }> = [];
    if (model.version) {
      meta.push({ label: 'Schema version', value: model.version });
    }
    if (model.projectId) {
      meta.push({ label: 'Project id', value: model.projectId });
    }
    for (const key of Object.keys(model.metadata)) {
      const value = model.metadata[key];
      meta.push({
        label: key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value)
      });
    }
    if (meta.length > 0) {
      this.root.append(section('Project metadata', factList(meta)));
    }
  }

  /** Renders the synthetic "Agent memory" node — an agent-level capability. */
  private renderMemory(node: ResourceNode): void {
    this.root.append(headerBlock('memory', node.name, kindLabel('memory')));

    if (node.badges.length > 0) {
      const badgeRow = el('div', { class: 'badge-row' });
      for (const badge of node.badges) {
        badgeRow.append(el('span', { class: `badge badge--${badge.tone}`, text: badge.label }));
      }
      this.root.append(badgeRow);
    }

    if (node.description) {
      this.root.append(el('p', { class: 'muted-note', text: node.description }));
    }

    const enabled = asRecord(node.raw).agentMemory === true;
    this.root.append(
      section(
        'Memory',
        checkboxField('Enabled', enabled, (v) =>
          this.post({ type: 'editAgentField', path: ['metadata', 'agentMemory'], value: v })
        )
      )
    );

    this.root.append(section('Details', factList(node.facts)));
    this.root.append(rawBlock('Raw memory config', node.raw));
  }

  private renderResource(node: ResourceNode): void {
    if (node.kind === 'memory') {
      this.renderMemory(node);
      return;
    }
    this.root.append(headerBlock(node.kind, node.name, kindLabel(node.kind)));

    if (node.badges.length > 0) {
      const badgeRow = el('div', { class: 'badge-row' });
      for (const badge of node.badges) {
        badgeRow.append(el('span', { class: `badge badge--${badge.tone}`, text: badge.label }));
      }
      this.root.append(badgeRow);
    }

    if (node.sourceUri) {
      const uri = node.sourceUri;
      this.root.append(
        el('div', { class: 'inspector-actions' }, [
          linkButton('Open resource.json', () => this.post({ type: 'openResource', uri }))
        ])
      );
    }

    // Editable: description.
    this.root.append(
      section(
        'Description',
        textArea(node.description ?? '', 3, (v) => this.editResource(node, ['description'], v))
      )
    );

    // Editable: enabled (tools carry an isEnabled flag).
    if (node.kind.startsWith('tool-')) {
      this.root.append(
        section(
          'Status',
          checkboxField('Enabled', node.enabled, (v) =>
            this.editResource(node, ['isEnabled'], v)
          )
        )
      );
    }

    // Editable: retrieval settings (index contexts).
    if (node.kind === 'context-index') {
      const settings = asRecord(asRecord(node.raw).settings);
      const retrieval = el('div', {});
      retrieval.append(
        field(
          'Retrieval mode',
          selectField(
            typeof settings.retrievalMode === 'string' ? settings.retrievalMode : 'semantic',
            RETRIEVAL_MODES.map((m) => ({ value: m, label: m })),
            (v) => this.editResource(node, ['settings', 'retrievalMode'], v)
          )
        )
      );
      retrieval.append(
        field(
          'Result count',
          numberField(
            typeof settings.resultCount === 'number' ? settings.resultCount : undefined,
            { min: 1, step: 1 },
            (v) => this.editResource(node, ['settings', 'resultCount'], v)
          )
        )
      );
      retrieval.append(
        field(
          'Threshold',
          numberField(
            typeof settings.threshold === 'number' ? settings.threshold : undefined,
            { min: 0, max: 1, step: 0.05 },
            (v) => this.editResource(node, ['settings', 'threshold'], v)
          )
        )
      );
      this.root.append(section('Retrieval settings', retrieval));
    }

    // Read-only sections.
    this.root.append(section('Details', factList(node.facts)));
    if (node.parameters && node.parameters.length > 0) {
      this.root.append(section('Parameters', parametersTable(node.parameters)));
    }
    if (node.channels && node.channels.length > 0) {
      const channels = el('div', {});
      for (const channel of node.channels) {
        channels.append(channelBlock(channel));
      }
      this.root.append(section('Channels', channels));
    }
    if (node.inputSchema) {
      this.root.append(section('Input schema', renderSchema(node.inputSchema, 'No input schema.')));
    }
    if (node.outputSchema) {
      this.root.append(
        section('Output schema', renderSchema(node.outputSchema, 'No output schema.'))
      );
    }
    this.root.append(rawBlock('Raw resource.json', node.raw));
  }

  private editAgent(path: string[], value: EditValue): void {
    this.post({ type: 'editAgentField', path, value });
  }

  private editResource(node: ResourceNode, path: string[], value: EditValue): void {
    if (!node.sourceUri) {
      return;
    }
    this.post({ type: 'editResourceField', uri: node.sourceUri, path, value });
  }
}
