// Keyboard shortcuts shared by every study.
//   Ctrl / Cmd + Z            undo
//   Ctrl / Cmd + Shift + Z    redo
//   Ctrl / Cmd + R            redo (the page does not reload)
//   \                         show / hide the side panel
// Shortcuts are ignored while typing in a text field (the Style JSON editor).

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'color', 'submit', 'reset']);

/** True for elements where keys type text, so shortcuts must not fire. */
export function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || (tag === 'INPUT' && !NON_TEXT_INPUTS.has(el.type));
}

/**
 * Which action a key event asks for.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }} e
 * @returns {'undo' | 'redo' | 'togglePanel' | null}
 */
export function shortcutFor(e) {
  const key = e.key.toLowerCase();
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'r' && !e.shiftKey) return 'redo'; // Shift + R stays a hard reload
    return null;
  }
  return key === '\\' ? 'togglePanel' : null;
}

/**
 * Listen for the shortcuts on the window.
 * @param {{ undo?: () => void, redo?: () => void, togglePanel?: () => void }} actions
 */
export function bindShortcuts(actions) {
  window.addEventListener('keydown', (e) => {
    if (isTextField(e.target)) return;
    const action = shortcutFor(e);
    if (!action || !actions[action]) return;
    e.preventDefault();
    actions[action]();
  });
}
