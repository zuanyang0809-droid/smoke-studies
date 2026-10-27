// The side panel over the full-window drawing surface: every control of a
// study lives in it. It collapses with its toggle button or the backslash
// key, and the collapsed state is remembered across visits and studies.

import { $ } from './dom.js';
import { bindShortcuts } from './shortcuts.js';

const KEY = 'smokeStudies.panelCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Wire the panel, its toggle, the undo / redo buttons and the shortcuts.
 * @param {{ undo: () => void, redo: () => void }} actions
 * @returns {{ syncHistory: (h: import('../core/history.js').History) => void }}
 */
export function mountPanel({ undo, redo }) {
  const panel = $('panel'), toggleButton = $('panel-toggle');
  let collapsed = readCollapsed();

  const show = () => {
    document.body.classList.toggle('panel-collapsed', collapsed);
    panel.inert = collapsed;
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.title = `${collapsed ? 'Show' : 'Hide'} controls (\\)`;
  };
  const toggle = () => {
    collapsed = !collapsed;
    show();
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch (e) {
      /* storage unavailable (private mode) */
    }
  };
  toggleButton.onclick = toggle;
  show();

  $('undo').onclick = undo;
  $('redo').onclick = redo;
  bindShortcuts({ undo, redo, togglePanel: toggle });

  return {
    syncHistory(h) {
      $('undo').disabled = !h.canUndo;
      $('redo').disabled = !h.canRedo;
    },
  };
}
