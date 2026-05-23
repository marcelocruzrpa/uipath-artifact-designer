/** Renders a JSON Schema object as an indented property tree. */
import type { JsonSchema, JsonSchemaProp } from '../../src/model/types';
import { el } from '../util';

const MAX_DEPTH = 5;

function typeLabel(prop: JsonSchemaProp): string {
  if (prop.$ref) {
    const ref = prop.$ref.split('/').pop() ?? prop.$ref;
    return ref === 'job-attachment' ? 'file' : ref;
  }
  if (prop.type === 'array') {
    const itemType = prop.items ? typeLabel(prop.items) : 'any';
    return `array<${itemType}>`;
  }
  return prop.type ?? 'any';
}

function isFile(prop: JsonSchemaProp): boolean {
  return typeof prop.$ref === 'string' && prop.$ref.includes('job-attachment');
}

function renderProp(
  name: string,
  prop: JsonSchemaProp,
  required: boolean,
  depth: number
): HTMLElement {
  const row = el('div', { class: 'schema-row' });

  const head = el('div', { class: 'schema-head' }, [
    el('span', { class: 'schema-name', text: name }),
    el('span', { class: 'schema-type', text: typeLabel(prop) })
  ]);
  if (required) {
    head.append(el('span', { class: 'schema-req', text: 'required' }));
  }
  if (isFile(prop)) {
    head.append(el('span', { class: 'schema-file', text: 'file' }));
  }
  row.append(head);

  const description = prop.description ?? prop.title;
  if (description) {
    row.append(el('div', { class: 'schema-desc', text: description }));
  }

  if (prop.properties && depth < MAX_DEPTH) {
    const children = el('div', { class: 'schema-children' });
    const childRequired = new Set(prop.required ?? []);
    for (const childName of Object.keys(prop.properties)) {
      children.append(
        renderProp(childName, prop.properties[childName], childRequired.has(childName), depth + 1)
      );
    }
    row.append(children);
  }
  return row;
}

export function renderSchema(schema: JsonSchema | undefined, emptyText: string): HTMLElement {
  const container = el('div', { class: 'schema-tree' });
  const properties = schema?.properties;
  if (!properties || Object.keys(properties).length === 0) {
    container.append(el('p', { class: 'muted-note', text: emptyText }));
    return container;
  }
  const required = new Set(schema?.required ?? []);
  for (const name of Object.keys(properties)) {
    container.append(renderProp(name, properties[name], required.has(name), 0));
  }
  return container;
}
