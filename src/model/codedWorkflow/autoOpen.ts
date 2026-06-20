/**
 * Pure decision for the "auto-open coded workflows in the visual designer"
 * setting (`uipathArtifactDesigner.codedWorkflow.autoOpenDesigner`). Kept
 * `vscode`-free so the host wiring stays a thin shell and this rule is
 * unit-testable in plain Node — the same purity split the rest of the
 * coded-workflow model uses.
 *
 * The host (`extension.ts`) supplies the primitives: the active editor's URI
 * scheme + path, whether the setting is enabled, whether the document content
 * looks like a coded workflow (`isCodedWorkflowSource`), and whether the user
 * has explicitly reopened this URI as text this session.
 *
 * PURITY RULE: zero imports.
 */
export interface AutoOpenDecision {
  /** URI scheme of the active editor's document (`file`, `git`, `untitled`, …). */
  scheme: string;
  /** Lower-cased URI path of the document. */
  pathLower: string;
  /** The `autoOpenDesigner` setting value. */
  enabled: boolean;
  /** Whether the document content looks like a coded workflow. */
  isWorkflow: boolean;
  /** Whether the user reopened THIS uri as text this session (don't bounce back). */
  suppressed: boolean;
}

/**
 * True when the host should reopen the active `.cs` text editor in the Coded
 * Workflow Canvas. Only on-disk (`file`) `.cs` files that actually look like a
 * coded workflow qualify, so plain C# files and diff/`git:` views are never
 * hijacked, and a URI the user explicitly reopened as text is left alone.
 */
export function shouldAutoOpenCodedWorkflow(d: AutoOpenDecision): boolean {
  return (
    d.enabled &&
    !d.suppressed &&
    d.scheme === 'file' &&
    d.pathLower.endsWith('.cs') &&
    d.isWorkflow
  );
}
