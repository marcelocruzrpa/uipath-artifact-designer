/**
 * Cheap pre-gate that decides whether a C# source file looks like a UiPath
 * coded workflow before we spend a real parse on it.
 *
 * Two marker forms are accepted:
 *  - a base list containing `CodedWorkflow` (`class X : CodedWorkflow`), or
 *  - a `[Workflow]` / `[TestCase]` attribute — this covers partial classes
 *    whose base list lives in another file.
 *
 * PURITY RULE: zero imports. Shared between the extension host, scripts, and
 * tests.
 */

const WORKFLOW_PATTERN =
  /:\s*[^{;]*\bCodedWorkflow\b|\[\s*(Workflow|TestCase)\s*[\]\(]/;

/**
 * Return true when `text` looks like a coded-workflow source file.
 * Only the first 2 MB are scanned to bound worst-case cost on huge files.
 *
 * DELIBERATE OVER-ACCEPT: this is a CHEAP regex pre-gate, not the authority.
 * It can false-positive on `CodedWorkflow` / `[Workflow]` appearing inside a
 * comment or string (e.g. `// : CodedWorkflow`), because tightening toward a
 * strict class-header shape risks UNDER-matching real partial classes whose
 * base list lives in another file.  A false positive is harmless: `buildModel`
 * re-parses and, finding no actual workflow class, yields an empty result —
 * the model builder, not this gate, is the real decision.
 */
export function isCodedWorkflowSource(text: string): boolean {
  return WORKFLOW_PATTERN.test(text.slice(0, 2_000_000));
}
