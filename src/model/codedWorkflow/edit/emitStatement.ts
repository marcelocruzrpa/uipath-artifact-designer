// src/model/codedWorkflow/edit/emitStatement.ts
// PURITY: no vscode/fs/path/node:* imports. Pure string assembly.
import type { PaletteItem } from './editCatalog';
import type { CatalogEmitArg } from '../classify/tier1Catalog';
import { requoteString } from './quoting';

/**
 * Whether a trailing `;` should be appended to a raw statement. A bare
 * expression/statement needs one; these do NOT:
 *   - already terminated (`;`),
 *   - a block delimiter (`{` / `}`) — a `;` would be stray/malformed,
 *   - a block-comment close (star-slash),
 *   - a line comment (`//…`) — the `;` would just extend the comment text.
 */
function needsSemicolon(text: string): boolean {
  if (text === '') return false;
  if (text.startsWith('//')) return false;
  return !(
    text.endsWith(';') ||
    text.endsWith('{') ||
    text.endsWith('}') ||
    text.endsWith('*/')
  );
}

/** Render one arg value to source per its schema kind (strings auto-quoted). */
function renderArg(schema: CatalogEmitArg, value: string): string {
  if (schema.kind === 'string') {
    // Already a literal? keep it. Otherwise treat the text as CONTENT + quote.
    const trimmed = value.trim();
    if (/^[@$]{0,2}"/.test(trimmed)) return trimmed;
    return requoteString(value, '""');
  }
  return value;
}

/**
 * Emit exactly ONE statement's C# source.
 *   - catalog: substitute {recv}/{args} in the template, prepend `var x = ` when
 *     a result binding is given.
 *   - assign:  `var <name> = <value>;`
 *   - add-item:`<coll>.Add(<item>);`
 *   - raw:     the user's `rawText` verbatim, `;`-terminated.
 */
export function emitStatement(
  item: PaletteItem,
  argValues: string[],
  resultBinding?: string,
  rawText?: string
): string {
  switch (item.kind) {
    case 'raw': {
      const text = (rawText ?? '').trim();
      // Append a terminating `;` ONLY when the text is a bare statement/expression
      // missing one. Skip it for: an existing `;`; a block delimiter (`{`/`}`) —
      // `if (x) {;` is malformed; a block-comment close (`*/`); and a line
      // comment (`//…`), where a trailing `;` would just be more comment text.
      return needsSemicolon(text) ? `${text};` : text;
    }
    case 'assign': {
      const [name, value] = argValues;
      // The Value field is a raw C# EXPRESSION (its schema kind is 'raw',
      // placeholder '0'), emitted verbatim — NOT auto-quoted like a 'string'
      // arg. So `value === 'hello'` deliberately yields `var x = hello;` (a bare
      // identifier reference), not `var x = "hello";`. This is by design: Assign
      // binds to any expression; a low-code dev who wants a string literal types
      // the quotes. (The parse-gate still rejects a value that won't compile.)
      return `var ${name} = ${value};`;
    }
    case 'add-item': {
      const [coll, valueItem] = argValues;
      return `${coll}.Add(${valueItem});`;
    }
    case 'catalog': {
      const rendered = item.args
        .map((schema, i) => renderArg(schema, argValues[i] ?? ''))
        .filter((s) => s !== '');
      const call = (item.template ?? '')
        .replace('{recv}', item.recv ?? '')
        .replace('{args}', rendered.join(', '));
      const binding =
        resultBinding !== undefined && resultBinding !== '' ? `var ${resultBinding} = ` : '';
      return `${binding}${call};`;
    }
  }
}
