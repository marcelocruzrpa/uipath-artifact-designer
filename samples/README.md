# Sample artifacts

One sample per artifact type the **UiPath Designer** extension supports — for
checking that each designer renders and edits correctly.

| Designer | Open this file | Sample content |
|----------|----------------|----------------|
| Agent | `agent/agent.json` | A low-code agent with a **tool** (`GetEmployeeRecord`), a **context** (`HRPolicyKnowledge`), an **escalation** (`ManagerApproval`), **memory** enabled (`metadata.agentMemory` — shown under Project metadata), prompts and I/O schema. |
| Maestro Flow | `maestro-flow/maestro-flow.flow` | Manual trigger → script action → decision → two end nodes (true / false branches). |
| Maestro BPMN | `maestro-bpmn/maestro-bpmn.bpmn` | A BPMN 2.0 process — start event, service task, exclusive gateway, two end events — with UiPath extension elements. |
| Maestro Case | `maestro-case/caseplan.json` | A v20 case plan — trigger, 3 stages + an exception stage, 3 edges, an entry condition, an exit condition, and stage- and case-level SLA rules. |
| Coded App | `coded-app/action-schema.json` | An action-schema contract whose inputs / outputs / inOuts / outcomes cover every field type (string, number, integer, boolean, array, object), plus `.uipath/app.config.json` status. |

> **Note on the agent tool:** `GetEmployeeRecord` deliberately has an unbound
> connection, so the designer shows a "connection not bound" warning badge —
> handy for checking how issue indicators render.

> **Note on memory:** low-code agents model memory as the `agentMemory`
> capability flag (not a node); the designer surfaces it in the agent's
> **Project metadata** section.

## How to test

1. In the extension repo, run `npm run build`.
2. Press **F5** and pick **"Run Extension — Samples"** — an Extension
   Development Host opens with this `samples/` folder loaded.
3. Open each entry file above; its visual designer opens automatically. Use the
   **Raw** toolbar button (or **Reopen as Text**) to view the underlying source.
4. Try an edit (e.g. rename a Flow node, toggle a Coded App field's *Required*):
   the file goes dirty and **Ctrl+S** saves it.

The Maestro and agent samples were scaffolded with the `uip` CLI and enriched
with its editing subcommands (`maestro flow node/edge`, `maestro case
stages/edges/conditions/sla`); the agent resources, the BPMN diagram, and the
Coded App contract were authored to the documented UiPath schemas. This folder
is excluded from the packaged `.vsix`.
