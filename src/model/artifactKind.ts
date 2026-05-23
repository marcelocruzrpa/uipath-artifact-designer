/**
 * The set of UiPath artifact types the designer can edit.
 *
 * Imported by BOTH the extension host and the webview — keep free of any
 * `vscode`, Node, or DOM dependency.
 */
export type ArtifactKind =
  | 'agent'
  | 'maestro-flow'
  | 'maestro-bpmn'
  | 'maestro-case'
  | 'coded-app';
