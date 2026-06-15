// src/model/codedWorkflow/edit/emitStatement.ts
// PURITY: no vscode/fs/path/node:* imports. Pure string assembly.
import type { PaletteItem } from './editCatalog';
import type { CatalogEmitArg } from '../classify/tier1Catalog';
import { requoteString } from './quoting';

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
      return text.endsWith(';') || text.endsWith('}') ? text : `${text};`;
    }
    case 'assign': {
      const [name, value] = argValues;
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
