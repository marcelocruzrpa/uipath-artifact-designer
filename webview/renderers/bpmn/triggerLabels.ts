/**
 * Friendly display labels for UiPath trigger start events.
 *
 * A UiPath Maestro BPMN encodes a process trigger as a `bpmn:startEvent` whose
 * `name` attribute is the trigger TYPE id — e.g. `core.trigger.manual`.
 * Rendering that id verbatim on the canvas is unreadable. These helpers map
 * such an id to a human label for DISPLAY only; the underlying `name` (and the
 * saved `.bpmn` file) is never changed.
 *
 * Pure — no DOM, bpmn-js or Node dependency, so it is unit-testable.
 */

/**
 * A namespaced trigger type id: a dotted identifier with a `.trigger.` segment,
 * e.g. `core.trigger.manual`. Deliberately strict — a real, human-entered
 * element name has spaces / punctuation, or simply lacks a `.trigger.` segment,
 * so it never matches.
 */
const TRIGGER_TYPE_ID = /^[a-z][\w-]*\.trigger\.[\w.-]+$/i;

/**
 * Explicit labels for trigger ids whose generic derivation would read poorly.
 * The generic rule (last segment, Title Case, + " trigger") covers the rest.
 */
const EXPLICIT_LABELS: Record<string, string> = {
  'core.trigger.manual': 'Manual trigger'
};

/** True when `name` is a UiPath trigger type id rather than a human name. */
export function isTriggerTypeId(name: string): boolean {
  return TRIGGER_TYPE_ID.test(name);
}

/** Title-cases a trigger-kind token, splitting camelCase and `-` / `_`. */
function humanizeKind(kind: string): string {
  const words = kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (words.length === 0) {
    return kind;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Returns a human-readable label for a BPMN element `name`. When `name` is a
 * UiPath trigger type id it is translated (`core.trigger.manual` →
 * `Manual trigger`); any other string is returned unchanged.
 */
export function triggerDisplayLabel(name: string): string {
  if (!isTriggerTypeId(name)) {
    return name;
  }
  const explicit = EXPLICIT_LABELS[name.toLowerCase()];
  if (explicit) {
    return explicit;
  }
  const kind = name.split('.').pop() ?? name;
  return `${humanizeKind(kind)} trigger`;
}
