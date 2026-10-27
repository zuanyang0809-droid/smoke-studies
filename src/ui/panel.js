// The side panel over the full-window drawing surface: every control of a
// study lives in it. It collapses with its toggle button or the backslash key.
//
// On every load it starts open as a hint that the controls are there, then
// slides away after a few seconds and the toggle button pulses so people
// know where to reopen it. Hovering, focusing or using the panel during
// the intro keeps it open; drawing on the canvas does not.

import { $ } from './dom.js';
import { bindShortcuts } from './shortcuts.js';

export const INTRO_MS = 5500;

/**
 * Wire the panel, its toggle, the undo / redo buttons and the shortcuts.
 * @param {{ undo: () => void, redo: () => void }} actions
 * @returns {{ syncHistory: (h: import('../core/history.js').History) => void }}
 */
export function mountPanel({ undo, redo }) {
  const panel = $('panel'), toggleButton = $('panel-toggle');
  let collapsed = false;

  const show = () => {
    document.body.classList.toggle('panel-collapsed', collapsed);
    panel.inert = collapsed;
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.title = `${collapsed ? 'Show' : 'Hide'} controls (\\)`;
  };

  let intro = setTimeout(() => {
    intro = null;
    collapsed = true;
    show();
    toggleButton.classList.add('pulse');
  }, INTRO_MS);
  const keepOpen = () => {
    clearTimeout(intro);
    intro = null;
  };
  for (const type of ['pointerenter', 'pointerdown', 'focusin', 'wheel']) panel.addEventListener(type, keepOpen);
  toggleButton.addEventListener('animationend', () => toggleButton.classList.remove('pulse'));

  const toggle = () => {
    keepOpen();
    collapsed = !collapsed;
    show();
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
