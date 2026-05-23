/**
 * Architecture guardrails.
 *
 * The webview bundle pulls in a curated subset of `src/` files (declared in
 * `tsconfig.webview.json`). Adding a `vscode`, `fs`, `path`, or `node:*`
 * import to any of those breaks the webview build — silently at compile
 * time, with a confusing error far from the cause.
 *
 * This test treats `tsconfig.webview.json`'s `include` list as the
 * authoritative manifest of cross-bundle files and asserts every `src/`
 * entry is host-API-free. Anything not in the list is host-only and may
 * import host APIs freely (no allowlist needed — the tsconfig itself
 * is the allowlist).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = join(__dirname, '..');

const HOST_IMPORT_PATTERN =
  /^\s*import[^'"]*from\s+['"](vscode|fs|path|node:[^'"]+|fs\/promises)['"]/m;

interface WebviewTsconfig {
  include?: string[];
}

function loadWebviewTsconfig(): WebviewTsconfig {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'tsconfig.webview.json'), 'utf8'));
}

describe('architecture guardrails', () => {
  it('every src/ file shared with the webview is free of host-only imports', () => {
    const tsconfig = loadWebviewTsconfig();
    const sharedFiles = (tsconfig.include ?? []).filter(
      (entry) => entry.startsWith('src/') && !entry.includes('*')
    );

    expect(sharedFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const rel of sharedFiles) {
      const abs = join(PROJECT_ROOT, rel);
      const text = readFileSync(abs, 'utf8');
      if (HOST_IMPORT_PATTERN.test(text)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every src/ entry in tsconfig.webview include actually exists', () => {
    const tsconfig = loadWebviewTsconfig();
    const sharedFiles = (tsconfig.include ?? []).filter(
      (entry) => entry.startsWith('src/') && !entry.includes('*')
    );

    for (const rel of sharedFiles) {
      const stat = statSync(join(PROJECT_ROOT, rel));
      expect(stat.isFile(), `expected ${rel} to be a file`).toBe(true);
    }
  });
});
