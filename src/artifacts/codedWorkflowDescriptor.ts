/**
 * Artifact descriptor for UiPath Coded Workflows (`.cs` files that inherit
 * `CodedWorkflow` or carry a `[Workflow]` / `[TestCase]` entry point).
 *
 * `loadModel` parses the document with the tree-sitter C# singleton, builds
 * the v0 model (one flat raw chip per leaf statement — full classification
 * lands in T1.4), and applies the R8 keep-last-good policy: clean parses are
 * remembered per-document in a bounded LRU, and catastrophically broken
 * mid-edit parses render the last clean model marked `'stale'` instead of a
 * blank canvas.  After the first successful render, `loadModel` only throws
 * when there is no last-good model to fall back on (e.g. wasm init failure
 * on the very first load).
 */
import type * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import type { ArtifactDescriptor, DetectResult } from '../model/artifactDescriptor';
import { buildModel, nowMs } from '../model/codedWorkflow/buildModel';
import { isCodedWorkflowSource } from '../model/codedWorkflow/detectSource';
import { extractFileFacts, type FileFacts } from '../model/codedWorkflow/graph/graphFacts';
import { getCSharpParser } from '../model/codedWorkflow/parser';
import { resolveRenderable } from '../model/codedWorkflow/stale';
import type { ArtifactModel, CodedWorkflowModel } from '../model/types';
import { uriBasename } from '../util/fsHelpers';
import { findProjectRoot, relPathInProject } from './codedProject';
import { CodedProjectIndex } from './codedProjectIndex';

function detectCodedWorkflow(document: vscode.TextDocument): DetectResult {
  if (isCodedWorkflowSource(document.getText())) {
    return { ok: true };
  }
  return {
    ok: false,
    fallback: {
      type: 'fallback',
      kind: 'not-coded-workflow',
      message:
        'This C# file does not inherit CodedWorkflow and has no [Workflow] entry point, ' +
        'so there is no canvas for it. Helper classes appear as nodes in the project ' +
        'call graph instead.'
    }
  };
}

// ---------------------------------------------------------------------------
// Last-good model cache (R8)
// ---------------------------------------------------------------------------

/** Max documents whose last clean model is retained. */
const LAST_GOOD_CAPACITY = 20;

/**
 * Insertion-ordered LRU keyed by `document.uri.toString()`.  Updated ONLY on
 * clean parses (`parseErrorCount === 0`); a re-store refreshes recency via
 * delete-then-set, and the oldest entry is evicted past capacity.
 */
const lastGoodModels = new Map<string, CodedWorkflowModel>();

function rememberLastGood(key: string, model: CodedWorkflowModel): void {
  lastGoodModels.delete(key);
  lastGoodModels.set(key, model);
  if (lastGoodModels.size > LAST_GOOD_CAPACITY) {
    const oldest = lastGoodModels.keys().next().value;
    if (oldest !== undefined) {
      lastGoodModels.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------------------
// loadModel
// ---------------------------------------------------------------------------

async function loadCodedWorkflowModel(document: vscode.TextDocument): Promise<ArtifactModel> {
  const key = document.uri.toString();
  const lastGood = lastGoodModels.get(key);

  try {
    // Resolve the UiPath project root first: the active file's graph facts
    // need a project-relative path, extracted from the SAME tree as the
    // model (the dirty buffer is the truth for the file being edited).
    const projectRoot = await findProjectRoot(document.uri);
    const handle = await getCSharpParser();
    const text = document.getText();
    const parseStart = nowMs();
    const tree = handle.parse(text);
    let fresh: CodedWorkflowModel;
    let activeFacts: FileFacts | undefined;
    try {
      fresh = buildModel(tree, text, {
        fileName: uriBasename(document.uri),
        fileUri: key,
        parseMs: nowMs() - parseStart
      });
      if (projectRoot !== undefined) {
        activeFacts = extractFileFacts(relPathInProject(projectRoot, document.uri), text, tree);
      }
    } finally {
      tree.delete();
    }

    // T2.2: project call graph. Never fail the canvas because the graph
    // broke — degrade to `graph: null` plus a warning diagnostic.
    if (projectRoot !== undefined) {
      try {
        fresh.graph = await CodedProjectIndex.for(projectRoot).getGraph(document, activeFacts);
      } catch (err) {
        fresh.graph = null;
        fresh.diagnostics.push({
          severity: 'warning',
          message: `Call graph unavailable: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    } else {
      fresh.graph = null;
    }

    if (fresh.parseErrorCount === 0) {
      rememberLastGood(key, fresh);
    }
    return resolveRenderable(fresh, lastGood);
  } catch (err) {
    // E.g. wasm init failure. With a last-good model available, degrade to a
    // stale render instead of an error strip; otherwise surface the error.
    if (lastGood !== undefined) {
      return {
        ...lastGood,
        parseHealth: 'stale',
        staleReason: err instanceof Error ? err.message : String(err)
      };
    }
    throw err;
  }
}

async function applyCodedWorkflowEdit(): Promise<void> {
  // R9: read-only — the coded-workflow canvas never writes back to the .cs file.
}

export const codedWorkflowDescriptor: ArtifactDescriptor = {
  kind: 'coded-workflow',
  viewType: VIEW_TYPES['coded-workflow'],
  // Watch every .cs sibling (graph edges can change from any file) plus the
  // project manifest (entry points / project name). The watcher is rooted at
  // the project root via watchBase, not the document's own directory.
  watchGlobs: '{**/*.cs,project.json}',
  watchBase: (document) => findProjectRoot(document.uri),
  // Graph node clicks may open any file in the project, so the openResource
  // guard widens from the document's directory to the project root.
  resourceRoot: (document) => findProjectRoot(document.uri),
  detect: detectCodedWorkflow,
  loadModel: loadCodedWorkflowModel,
  applyEdit: applyCodedWorkflowEdit
};
