/**
 * Pure parsing of a UiPath `project.json` into the facts the call graph
 * needs (T2.2).  Deliberately LOOSE: a malformed or partial project.json must
 * never break the canvas, so every failure mode degrades to a fallback name
 * and/or an empty entry-point set — this module never throws.
 *
 * PURITY RULE: no `vscode`, `fs`, `path`, or `node:*` imports — the host
 * (`src/artifacts/codedProject.ts`) does the I/O and hands the parsed JSON
 * (or `undefined`) here, so these rules are unit-testable in plain Node.
 */

export interface ProjectJsonFacts {
  /** `name` from project.json, or `fallbackName` when missing/invalid. */
  name: string;
  /**
   * Normalized (forward-slash, no leading `./`) rel paths of the
   * `entryPoints[].filePath` entries that end in `.cs`. Empty on any
   * malformed shape.
   */
  entryPointRelPaths: Set<string>;
}

/** Forward slashes, leading `./` stripped; case-preserving. */
function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Distill `project.json` facts from already-parsed JSON. `json` may be
 * anything (including `undefined` for an unreadable/malformed file).
 */
export function parseProjectJson(json: unknown, fallbackName: string): ProjectJsonFacts {
  const entryPointRelPaths = new Set<string>();
  let name = fallbackName;

  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { name, entryPointRelPaths };
  }
  const record = json as Record<string, unknown>;

  if (typeof record.name === 'string' && record.name.trim().length > 0) {
    name = record.name.trim();
  }

  if (Array.isArray(record.entryPoints)) {
    for (const entry of record.entryPoints) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const filePath = (entry as Record<string, unknown>).filePath;
      if (typeof filePath !== 'string') {
        continue;
      }
      const normalized = normalizeRelPath(filePath.trim());
      if (normalized.length > 0 && normalized.toLowerCase().endsWith('.cs')) {
        entryPointRelPaths.add(normalized);
      }
    }
  }

  return { name, entryPointRelPaths };
}
