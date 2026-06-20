/**
 * Tier-1 seed catalog: the UiPath coded-workflow service families and the
 * member calls we render as first-class cards.
 *
 * This module is pure DATA — template strings and literals only, no
 * functions. Consumers (matcher, normalizer, renderers, corpus scripts)
 * index it themselves.
 *
 * Member lists are SEED data: deliberately small and obviously-correct.
 * They will be finalized from corpus frequency in M0 — an unknown member of
 * a known family is still a tier-1 match by spec, so sparse entries only
 * affect card titles, never match coverage.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports.
 */

/** How a single call argument is rendered on a card. */
export interface CatalogArgSpec {
  /** Positional index (0-based) or the name of a named argument. */
  arg: number | string;
  /**
   * The C# parameter name this positional spec also matches when the call
   * passes it by name (`GetAsset(name: "x")`).  Only meaningful for a numeric
   * `arg`; lets a NAMED positional argument still resolve to its row instead of
   * being dropped (and then surfaced verbatim as overflow).
   */
  paramName?: string;
  /** Human label shown next to the rendered value. */
  label: string;
  /** Rendering strategy for the argument value. */
  render: 'text' | 'path' | 'target' | 'enum' | 'objectProps';
  /** For `objectProps`: the object-initializer property names to surface. */
  props?: string[];
  /** Optional max rendered length before truncation. */
  maxLen?: number;
}

/** One emittable/addable argument of a cataloged call (the INVERSE of CatalogArgSpec). */
export interface CatalogEmitArg {
  /** Label shown in the panel / palette form. */
  label: string;
  /**
   * Typed-input affordance for the value field. Mirrors CwArgSummary.editableKind
   * minus 'none' (every emit arg is fillable); 'string' content is auto-quoted
   * by the emitter, the rest are raw source text the parse-gate validates.
   */
  kind: 'string' | 'number' | 'bool' | 'identifier' | 'raw';
  /** false ⇒ optional (offer an add/remove toggle); omitted ⇒ required. */
  required?: boolean;
  /** Default source text for a freshly added optional arg (already in source form). */
  placeholder?: string;
}

/** How to re-emit (and add args to) a cataloged call. Pure data — no functions. */
export interface CatalogEmit {
  /**
   * The call as a template. `{recv}` ⇒ the service receiver (e.g. `system`) or
   * '' for a base call; `{args}` ⇒ the comma-joined emitted arguments. Result
   * binding (`var x = `) is prepended by the emitter, not the template.
   */
  template: string;
  /** Ordered argument schema; positional. Required args come first by convention. */
  args: CatalogEmitArg[];
  /** True when the call returns a value worth binding (palette offers a result name). */
  returnsValue?: boolean;
}

/** A cataloged service member call. */
export interface CatalogEntry {
  /** Exact C# method name (e.g. `GetAsset`). */
  method: string;
  /** Card title (e.g. `Get Asset`). */
  title: string;
  /** Arguments to surface on the card. */
  args: CatalogArgSpec[];
  /** Optional per-entry icon override. */
  icon?: string;
  /** How to re-emit / add args to this call (bidirectional catalog; L1). */
  emit?: CatalogEmit;
}

/** A service family — one lowercase service member on `CodedWorkflow`. */
export interface ServiceFamily {
  /**
   * Receiver identifier in source (e.g. `system`, `excel`), or
   * `BASE_FAMILY_ID` for bare base-class calls (`Log`, `RunWorkflow`).
   */
  id: string;
  /** Family display name shown on cards and in the corpus report. */
  displayName: string;
  /** Family icon id. */
  icon: string;
  /** Cataloged members. May be empty for wildcard/sparse families. */
  entries: CatalogEntry[];
  /**
   * Title template for families where EVERY member matches (e.g.
   * `workflows.AnyName(...)`). `{method}` is replaced with the member name.
   */
  wildcardTitleTemplate?: string;
}

/** Family id for bare base-class calls — never a receiver identifier. */
export const BASE_FAMILY_ID = '_base';

export const TIER1_CATALOG: readonly ServiceFamily[] = [
  {
    id: 'system',
    displayName: 'System',
    icon: 'gear',
    entries: [
      {
        method: 'GetAsset',
        title: 'Get Asset',
        args: [{ arg: 0, paramName: 'name', label: 'Name', render: 'text' }],
        emit: {
          template: '{recv}.GetAsset({args})',
          args: [{ label: 'Name', kind: 'string', placeholder: '""' }],
          returnsValue: true
        }
      },
      {
        method: 'SetAsset',
        title: 'Set Asset',
        args: [{ arg: 0, paramName: 'name', label: 'Name', render: 'text' }]
      },
      {
        method: 'GetCredential',
        title: 'Get Credential',
        args: [{ arg: 0, paramName: 'name', label: 'Name', render: 'text' }]
      },
      {
        method: 'AddQueueItem',
        title: 'Add Queue Item',
        args: [{ arg: 0, paramName: 'queueName', label: 'Queue', render: 'text' }],
        emit: {
          template: '{recv}.AddQueueItem({args})',
          args: [
            { label: 'Queue', kind: 'string', placeholder: '""' },
            { label: 'Item', kind: 'identifier', required: false, placeholder: 'item' }
          ]
        }
      },
      {
        method: 'GetTransactionItem',
        title: 'Get Transaction Item',
        args: [{ arg: 0, label: 'Queue', render: 'text' }]
      },
      {
        method: 'SetTransactionStatus',
        title: 'Set Transaction Status',
        args: [{ arg: 0, label: 'Transaction', render: 'text' }]
      }
    ]
  },
  {
    id: 'uiAutomation',
    displayName: 'UI Automation',
    icon: 'window',
    entries: [
      {
        method: 'Open',
        title: 'Open',
        args: [{ arg: 0, label: 'Target', render: 'target' }]
      },
      {
        method: 'Attach',
        title: 'Attach',
        args: [{ arg: 0, label: 'Target', render: 'target' }]
      }
    ]
  },
  {
    id: 'workflows',
    displayName: 'Workflows',
    icon: 'type-hierarchy',
    entries: [],
    wildcardTitleTemplate: 'Invoke Workflow {method}'
  },
  {
    id: 'connections',
    displayName: 'Integration Service',
    icon: 'plug',
    entries: []
  },
  {
    id: 'excel',
    displayName: 'Excel',
    icon: 'table',
    entries: [
      {
        method: 'UseExcelFile',
        title: 'Use Excel File',
        args: [
          { arg: 0, label: 'File', render: 'path' },
          {
            arg: 1,
            label: 'Options',
            render: 'objectProps',
            props: ['SaveChanges', 'CreateIfNotExists', 'ReadOnly']
          }
        ]
      }
    ]
  },
  {
    id: 'word',
    displayName: 'Word',
    icon: 'file',
    entries: [
      {
        method: 'UseWordFile',
        title: 'Use Word File',
        args: [{ arg: 0, label: 'File', render: 'path' }]
      }
    ]
  },
  {
    // Lowercase on purpose: the receiver text in real coded workflows is
    // `powerpoint.` (M0 lever L1 — the old `powerPoint` id never matched).
    id: 'powerpoint',
    displayName: 'PowerPoint',
    icon: 'file-media',
    entries: []
  },
  {
    id: 'java',
    displayName: 'Java',
    icon: 'coffee',
    entries: [
      {
        method: 'UseJavaScope',
        title: 'Use Java Scope',
        args: [
          { arg: 0, label: 'Options', render: 'objectProps', props: ['JavaPath'] }
        ]
      }
    ]
  },
  {
    id: 'python',
    displayName: 'Python',
    icon: 'code',
    entries: [
      {
        method: 'UsePythonScope',
        title: 'Use Python Scope',
        args: [
          { arg: 0, label: 'Options', render: 'objectProps', props: ['Path', 'LibraryPath'] }
        ]
      }
    ]
  },
  {
    id: 'ftp',
    displayName: 'FTP',
    icon: 'cloud-upload',
    entries: []
  },
  {
    id: 'database',
    displayName: 'Database',
    icon: 'database',
    entries: []
  },
  {
    id: 'credentials',
    displayName: 'Credentials',
    icon: 'key',
    entries: []
  },
  {
    id: 'testing',
    displayName: 'Testing',
    icon: 'beaker',
    entries: []
  },
  {
    id: BASE_FAMILY_ID,
    displayName: 'Workflow',
    icon: 'play-circle',
    entries: [
      {
        method: 'Log',
        title: 'Log',
        args: [{ arg: 0, label: 'Message', render: 'text' }],
        emit: {
          template: 'Log({args})',
          args: [{ label: 'Message', kind: 'string', placeholder: '""' }]
        }
      },
      {
        method: 'RunWorkflow',
        title: 'Run Workflow',
        args: [{ arg: 0, label: 'Workflow', render: 'path' }]
      },
      {
        method: 'RunWorkflowAsync',
        title: 'Run Workflow (Async)',
        args: [{ arg: 0, label: 'Workflow', render: 'path' }]
      }
    ]
  }
];
