/**
 * Trois fonctions pour fabriquer du DOM — et c'est tout.
 *
 * Le site n'embarque aucun framework : il rend des tableaux de vraies données
 * (40 diagnostics, quelques signatures), donc un `createElement` propre suffit,
 * et le bundle reste petit. Aucune chaîne HTML n'est injectée avec `innerHTML` :
 * les textes du moteur (messages d'erreur, gabarits) passent par `textContent`,
 * donc rien ne peut être interprété comme du balisage.
 */

/** Attributs acceptés : les `false`/`undefined` sont ignorés, les fonctions
 * sont posées comme **propriétés** (un `onclick` en attribut ne s'exécute
 * jamais : le navigateur reçoit le texte de la fonction). */
export type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/** Un enfant de nœud : du texte, un nœud, ou rien. */
export type Child = Node | string | number | null | undefined | false;

/** Crée un élément, pose ses attributs, ajoute ses enfants. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (typeof value === 'function') {
      (node as unknown as Record<string, unknown>)[name] = value;
    } else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

/** Ajoute des enfants à un nœud (texte brut compris). */
export function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Vide un conteneur et y place de nouveaux enfants. */
export function mount(target: Element | null, ...children: Child[]): void {
  if (!target) return;
  target.replaceChildren();
  append(target, children);
}

/** Une ligne de tableau : une cellule par valeur. */
function row(cells: Child[]): HTMLTableRowElement {
  return el('tr', {}, ...cells.map((cell) => el('td', {}, cell)));
}

/**
 * Un tableau accessible : en-têtes `<th>` portés par `scope="col"`, corps en
 * `<tbody>`. Une liste vide rend un message « rien à montrer » à la place.
 */
export function table(headers: string[], rows: Child[][], empty: string): HTMLElement {
  if (rows.length === 0) return el('p', { class: 'empty' }, empty);
  const head = el(
    'thead',
    {},
    el('tr', {}, ...headers.map((label) => el('th', { scope: 'col' }, label))),
  );
  return el('div', { class: 'table-wrap' }, el('table', {}, head, el('tbody', {}, ...rows.map(row))));
}

/** Une pastille colorée, dont le ton vient de `@dejavu/present`. */
export function badge(label: string, tone: string): HTMLElement {
  return el('span', { class: `badge tone-${tone}` }, label);
}
