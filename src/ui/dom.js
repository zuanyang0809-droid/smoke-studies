// Tiny DOM helpers so the UI modules can build their own markup.

export const $ = (id) => document.getElementById(id);

/**
 * Create an element. `props` sets properties (className, textContent, onclick...),
 * except `attrs` and `style`, which are applied as attributes / inline styles.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  const { attrs, style, ...rest } = props;
  Object.assign(el, rest);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (style) Object.assign(el.style, style);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

/** Tabler icon (webfont loaded by each page). */
export const icon = (name) => h('i', { className: `ti ti-${name}`, attrs: { 'aria-hidden': 'true' } });

/**
 * Wire a group of buttons that share a data attribute into a single choice.
 * @returns {(value: string) => void} marks the active button
 */
export function toggleGroup(attr, onSelect) {
  const buttons = [...document.querySelectorAll(`[data-${attr}]`)];
  const setActive = (value) => buttons.forEach((b) => b.classList.toggle('is-on', b.dataset[attr] === value));
  buttons.forEach((b) => (b.onclick = () => onSelect(b.dataset[attr])));
  return setActive;
}
