/** Tiny DOM helpers for the webview. No innerHTML is used anywhere. */

interface ElOptions {
  class?: string;
  text?: string;
  title?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElOptions,
  children?: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options) {
    if (options.class) {
      node.className = options.class;
    }
    if (options.text !== undefined) {
      node.textContent = options.text;
    }
    if (options.title) {
      node.title = options.title;
    }
  }
  if (children) {
    for (const child of children) {
      node.append(child);
    }
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      node.setAttribute(key, String(attrs[key]));
    }
  }
  return node;
}

export function clearChildren(node: Element): void {
  node.replaceChildren();
}

/** Builds a labeled section block: <div.section><h3>title</h3>...children</div>. */
export function section(title: string, ...children: Array<Node | string>): HTMLElement {
  return el('div', { class: 'section' }, [
    el('h3', { class: 'section-title', text: title }),
    ...children
  ]);
}

/** Renders a definition list of label/value pairs. */
export function factList(facts: Array<{ label: string; value: string }>): HTMLElement {
  const dl = el('dl', { class: 'facts' });
  for (const fact of facts) {
    dl.append(el('dt', { text: fact.label }), el('dd', { text: fact.value }));
  }
  return dl;
}

export function note(text: string): HTMLElement {
  return el('p', { class: 'muted-note', text });
}

/**
 * Cheap structural dirty check for the parsed artifact models. The models are
 * plain JSON-serializable trees (no functions, no cycles), so a stable
 * stringify comparison is a correct equality test and lets a renderer skip a
 * full DOM teardown when an incoming update is identical to what is shown.
 * Returns false (treat as changed) if either value cannot be serialized.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
