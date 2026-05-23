/**
 * Shared data types for the Maestro Flow (`.flow`) designer.
 *
 * Imported by BOTH the extension host and the webview — keep free of any
 * `vscode`, Node, or DOM dependency. Pure TypeScript interfaces only.
 */

/**
 * High-level classification of a flow node, derived from its `type` prefix.
 * Drives the node-card shape, accent color and inspector form.
 */
export type FlowNodeKind =
  | 'trigger'
  | 'action'
  | 'decision'
  | 'switch'
  | 'loop'
  | 'merge'
  | 'end'
  | 'terminate'
  | 'connector'
  | 'agent'
  | 'subflow'
  | 'unknown';

/** A node port — an attachment point for an edge. */
export interface FlowPort {
  /** Port id, used as `sourcePort` / `targetPort` on edges. */
  id: string;
  /** 'source' = outgoing, 'target' = incoming. */
  direction: 'source' | 'target';
  /** Human label, when the registry / definition supplies one. */
  label?: string;
}

/** A node position on the canvas (top-left corner, world coordinates). */
export interface FlowPosition {
  x: number;
  y: number;
}

/** A node box size. */
export interface FlowSize {
  width: number;
  height: number;
}

/** A classified, layout-resolved node in the flow graph. */
export interface FlowNode {
  /** Stable node id (unique within the flow). */
  id: string;
  /** Raw node `type` string, e.g. `core.action.script`. */
  type: string;
  /** Schema version of the node type. */
  typeVersion: string;
  /** Coarse classification used for rendering. */
  kind: FlowNodeKind;
  /** Display label (from `display.label`, falling back to the id). */
  label: string;
  /** Incoming ports (edges target these). */
  inputs: FlowPort[];
  /** Outgoing ports (edges source from these). */
  outputs: FlowPort[];
  /** Stored canvas position, when `layout.nodes[id].position` exists. */
  position: FlowPosition | null;
  /** Stored canvas size, when `layout.nodes[id].size` exists. */
  size: FlowSize | null;
  /** Collapsed flag from `layout.nodes[id].collapsed`. */
  collapsed: boolean;
  /** The raw `inputs` object of the node, for the inspector forms. */
  rawInputs: Record<string, unknown>;
}

/** A directed connection between two node ports. */
export interface FlowEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

/** A workflow-level variable (`variables.globals` entry). */
export interface FlowVariable {
  id: string;
  direction: string;
  type: string;
  defaultValue?: string;
  description?: string;
}
