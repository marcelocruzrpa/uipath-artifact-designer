/**
 * Moddle extension descriptor for the UiPath BPMN extension namespace.
 *
 * WHY THIS FILE IS MANDATORY
 * --------------------------
 * `bpmn-js` parses and re-serializes BPMN XML through `bpmn-moddle`. Any XML
 * element whose namespace `bpmn-moddle` does not recognize is **silently
 * dropped** on `saveXML()`. Maestro `.bpmn` files carry a large amount of
 * UiPath-specific metadata under the `uipath` namespace — root `uipath:variables`
 * and `uipath:bindings`, per-node `uipath:activity` / `uipath:event` /
 * `uipath:mapping` / `uipath:retry` wrappers, entry-point ids, and more. Without
 * this descriptor registered as a `moddleExtension`, every one of those elements
 * would vanish the first time the designer saves the file, silently corrupting
 * the document.
 *
 * DESIGN: PERMISSIVE BY CONSTRUCTION
 * ----------------------------------
 * The UiPath extension schema is broad and still evolving, and brownfield /
 * imported files may carry payloads this designer does not interpret. Rather
 * than model each `uipath:*` element precisely, every known element type is
 * declared as a maximally permissive shape:
 *
 *  - it accepts every attribute observed across the documented Maestro BPMN
 *    fixtures (`isAttr` string properties), so attributes round-trip;
 *  - it accepts an arbitrary text / CDATA body (`isBody`), so JSON payloads,
 *    schemas, scripts and expressions round-trip;
 *  - it accepts an arbitrary list of nested child `Element`s, so unknown nested
 *    UiPath content round-trips losslessly.
 *
 * This descriptor is verified for lossless `uipath:*` round-trip against the
 * Maestro BPMN validation fixtures (see `tmp-verify/` probes during Phase 4
 * development).
 *
 * No `vscode`, Node, or non-DOM dependency — it is a plain data object consumed
 * by `bpmn-js` in the webview.
 */

/** A single moddle property declaration. */
interface ModdleProperty {
  name: string;
  type: string;
  isAttr?: boolean;
  isBody?: boolean;
  isMany?: boolean;
}

/** A single moddle type declaration. */
interface ModdleType {
  name: string;
  /** Base types this type derives from. Mutually exclusive with `extends`. */
  superClass?: string[];
  /**
   * Existing (foreign) types this type augments with extra properties — the
   * moddle mechanism for attaching extension content to standard BPMN types.
   */
  extends?: string[];
  meta?: Record<string, unknown>;
  properties: ModdleProperty[];
}

/** A moddle package descriptor, as consumed by `bpmn-moddle` / `bpmn-js`. */
export interface ModdleDescriptor {
  name: string;
  uri: string;
  prefix: string;
  xml?: { tagAlias?: string };
  types: ModdleType[];
  associations?: unknown[];
}

/** The UiPath BPMN extension namespace URI. */
const UIPATH_URI = 'http://uipath.org/schema/bpmn';

/**
 * Every `uipath:*` element type, named in PascalCase. With
 * `xml.tagAlias: 'lowerCase'`, `bpmn-moddle` maps an XML tag such as
 * `<uipath:variables>` to the type `Variables` and `<uipath:entryPointId>` to
 * `EntryPointId`. Legacy PascalCase tags (e.g. `<uipath:Activity>`) collapse
 * onto the same lower-cased type — their payload is preserved; only the tag
 * casing is normalized to the documented canonical lower-case form on save.
 */
const UIPATH_TYPE_NAMES = [
  // root metadata
  'Variables',
  'Input',
  'InputOutput',
  'Output',
  'Variable',
  'Bindings',
  'Binding',
  'EntryPointId',
  'MigrationVersion',
  'IsTransactionRoot',
  'InputSchema',
  // per-node wrappers
  'Activity',
  'Event',
  'Type',
  'Context',
  'Mapping',
  'Retry',
  'ErrorMapping',
  'Error',
  'ErrorDefinition',
  'Tags',
  'Tag',
  'ScriptVersion',
  'LoopCharacteristics',
  'CaseManagement'
] as const;

/**
 * Every attribute observed on a `uipath:*` element across the documented
 * Maestro BPMN fixtures. Each is declared on every type so attributes always
 * round-trip — `bpmn-moddle` silently drops attributes a type does not
 * declare.
 */
const UIPATH_ATTRIBUTES = [
  'condition',
  'default',
  'detail',
  'elementId',
  'errorRef',
  'id',
  'inputCollection',
  'inputElement',
  'key',
  'maxRetryCount',
  'name',
  'preservation',
  'priority',
  'propertyAttribute',
  'resource',
  'resourceKey',
  'resourceSubType',
  'retryAllErrors',
  'retryBackoff',
  'retryable',
  'source',
  'target',
  'type',
  'value',
  'var',
  'version'
] as const;

/** Builds one maximally permissive moddle type for a `uipath:*` element. */
function permissiveType(name: string): ModdleType {
  return {
    name,
    superClass: ['Element'],
    // `allowedIn: ['*']` lets the element appear under any parent, including
    // `bpmn:extensionElements` and nested inside other UiPath elements.
    meta: { allowedIn: ['*'] },
    properties: [
      ...UIPATH_ATTRIBUTES.map(
        (attr): ModdleProperty => ({ name: attr, isAttr: true, type: 'String' })
      ),
      // Arbitrary text / CDATA body (JSON payloads, schemas, scripts).
      { name: 'body', isBody: true, type: 'String' },
      // Arbitrary nested child elements — preserves unknown nested content.
      { name: 'children', type: 'Element', isMany: true }
    ]
  };
}

/**
 * Augments the BPMN base element with a generic `uipath:*` children list.
 *
 * Maestro scaffolds `.bpmn` files in which some `uipath:*` elements (notably
 * `uipath:entryPointId`) sit DIRECTLY under a BPMN element such as
 * `bpmn:startEvent`, NOT wrapped in `bpmn:extensionElements`. `bpmn-moddle`
 * rejects — and silently drops — a foreign child of a standard BPMN type
 * unless that type declares a property to hold it. Extending `bpmn:BaseElement`
 * (the root of every BPMN element) with an `isMany` `Element` property makes
 * those direct-child UiPath elements round-trip losslessly too.
 */
const uipathAwareExtension: ModdleType = {
  name: 'UiPathAware',
  extends: ['bpmn:BaseElement'],
  properties: [{ name: 'uipathExtensions', type: 'Element', isMany: true }]
};

/**
 * The UiPath moddle extension descriptor. Pass this to the `bpmn-js` Modeler
 * as `moddleExtensions: { uipath: uipathModdleDescriptor }`.
 */
export const uipathModdleDescriptor: ModdleDescriptor = {
  name: 'UiPath',
  uri: UIPATH_URI,
  prefix: 'uipath',
  xml: { tagAlias: 'lowerCase' },
  types: [...UIPATH_TYPE_NAMES.map(permissiveType), uipathAwareExtension],
  associations: []
};
