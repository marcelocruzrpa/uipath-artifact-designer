/**
 * Conservative recognition of the REFramework state machine — a loop driving a
 * `switch` over an enum state variable, `while(true){ switch(state){ case
 * State.Init: …; state = State.GetTransactionData; … } }`. Coded workflows have
 * no StateMachine activity, so REFramework ports reproduce it this way; this
 * detector lets the canvas surface the states + transitions every RPA developer
 * recognizes WITHOUT replacing the underlying model.
 *
 * PURELY ADDITIVE, MODEL-ONLY: it reads the already-built `CwContainer` tree
 * (no AST) and, on a match, attaches a `stateMachine` annotation to the
 * qualifying `switch`. The `switch`/`case`/Assign cards are untouched and still
 * render inside when expanded (honest). Any deviation from the exact shape →
 * no annotation → the normal container tree renders (never throws).
 *
 * MATCH (all required):
 *   - a `switch` directly inside a loop body (`while`/`for`/`do`),
 *   - header `Switch <stateVar>` where `<stateVar>` is a bare identifier,
 *   - every `case` label is `Case <Enum>.<Member>` for ONE consistent `<Enum>`
 *     (a `default` section is allowed and ignored; any non-enum case bails),
 *   - at least two cases.
 * Transitions per case are the distinct `<Enum>.<Member>` targets of Assign
 * pseudo-steps `‹stateVar› = …` found anywhere in that case (nested blocks
 * included).
 *
 * PURITY RULE: imports only the local model types. No `vscode`, `fs`, `path`,
 * or `node:*` imports.
 */
import type { CwContainer, CwStateMachine, CwStatement } from '../cwTypes';

const SWITCH_HEADER_RE = /^Switch\s+([A-Za-z_]\w*)$/;
const CASE_LABEL_RE = /^Case\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/;

/** Escape a string for use as a literal inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk a method body and attach a `stateMachine` annotation to every `switch`
 * that a loop drives over an enum state variable. Mutates the tree in place.
 */
export function annotateStateMachines(body: CwStatement[]): void {
  walk(body, false);
}

function walk(stmts: CwStatement[], insideLoopBody: boolean): void {
  for (const stmt of stmts) {
    if (stmt.type !== 'container') continue;
    if (stmt.kind === 'switch' && insideLoopBody) {
      const info = detectStateMachine(stmt);
      if (info !== null) stmt.stateMachine = info;
    }
    // A child statement is "inside a loop body" when ITS container is a loop.
    const childInLoop = stmt.kind === 'while' || stmt.kind === 'for' || stmt.kind === 'do';
    for (const slot of stmt.slots) {
      walk(slot.children, childInLoop);
    }
  }
}

/** The state-machine annotation for a `switch` container, or null if it is not one. */
function detectStateMachine(sw: CwContainer): CwStateMachine | null {
  const headerMatch = SWITCH_HEADER_RE.exec(sw.header);
  if (headerMatch === null) return null;
  const stateVar = headerMatch[1];

  let enumName: string | null = null;
  const states: CwStateMachine['states'] = [];
  for (const slot of sw.slots) {
    if (slot.role === 'default') continue; // a default section is allowed, ignored
    if (slot.role !== 'case') return null; // unexpected slot shape → bail
    const caseMatch = CASE_LABEL_RE.exec(slot.label);
    if (caseMatch === null) return null; // a non-`Enum.Member` case → not a clean SM
    const [, caseEnum, member] = caseMatch;
    if (enumName === null) enumName = caseEnum;
    else if (enumName !== caseEnum) return null; // mixed enums → bail
    states.push({ label: member, transitions: collectTransitions(slot.children, stateVar, caseEnum) });
  }

  if (enumName === null || states.length < 2) return null;
  return { stateVar, states };
}

/**
 * Distinct `<enumName>.<Member>` targets assigned to `stateVar` anywhere in
 * `stmts` (nested containers included). Reads the Assign pseudo-step text
 * (`state = State.Process`, `state = cond ? State.A : State.B`).
 */
function collectTransitions(
  stmts: CwStatement[],
  stateVar: string,
  enumName: string
): string[] {
  const found = new Set<string>();
  const assignRe = new RegExp(`^${escapeRegExp(stateVar)}\\s*=\\s*(.+)$`);
  const memberRe = new RegExp(`\\b${escapeRegExp(enumName)}\\.([A-Za-z_]\\w*)`, 'g');
  collect(stmts, found, assignRe, memberRe);
  return [...found];
}

function collect(
  stmts: CwStatement[],
  found: Set<string>,
  assignRe: RegExp,
  memberRe: RegExp
): void {
  for (const stmt of stmts) {
    if (stmt.type === 'pseudo') {
      const assignMatch = assignRe.exec(stmt.text);
      if (assignMatch !== null) {
        memberRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = memberRe.exec(assignMatch[1])) !== null) found.add(m[1]);
      }
    } else if (stmt.type === 'container') {
      for (const slot of stmt.slots) collect(slot.children, found, assignRe, memberRe);
    }
  }
}
