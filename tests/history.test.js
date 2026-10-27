import { describe, expect, it } from 'vitest';
import { History } from '../src/core/history.js';
import { isTextField, shortcutFor } from '../src/ui/shortcuts.js';

/** An entry that logs what happens to it. */
const entry = (name, log) => ({
  undo: () => log.push(`undo ${name}`),
  redo: () => log.push(`redo ${name}`),
  dispose: () => log.push(`dispose ${name}`),
});

describe('History', () => {
  it('undoes and redoes in stack order', () => {
    const log = [], h = new History();
    h.push(entry('a', log));
    h.push(entry('b', log));
    h.undo();
    h.undo();
    h.redo();
    expect(log).toEqual(['undo b', 'undo a', 'redo a']);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(true);
  });

  it('returns null and does nothing past either end', () => {
    const h = new History();
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('a new stroke clears and disposes the redo side', () => {
    const log = [], h = new History();
    h.push(entry('a', log));
    h.undo();
    h.push(entry('b', log));
    expect(log).toEqual(['undo a', 'dispose a']);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
  });

  it('keeps at most `limit` entries and disposes the oldest', () => {
    const log = [], h = new History(3);
    for (const n of ['a', 'b', 'c', 'd', 'e']) h.push(entry(n, log));
    expect(log).toEqual(['dispose a', 'dispose b']);
    expect(h.done.length).toBe(3);
    while (h.undo());
    expect(log.slice(2)).toEqual(['undo e', 'undo d', 'undo c']);
  });

  it('clear disposes everything and notifies', () => {
    const log = [];
    let changes = 0;
    const h = new History(30, () => changes++);
    h.push(entry('a', log));
    h.push(entry('b', log));
    h.undo();
    h.clear();
    expect(log).toEqual(['undo b', 'dispose a', 'dispose b']);
    expect(changes).toBe(4);
    expect(h.canUndo || h.canRedo).toBe(false);
  });

  it('entries without dispose are fine', () => {
    const h = new History(1);
    h.push({ undo() {}, redo() {} });
    h.push({ undo() {}, redo() {} });
    expect(h.done.length).toBe(1);
  });
});

describe('shortcuts', () => {
  const k = (key, mods = {}) => shortcutFor({ key, ...mods });

  it('maps undo and both redo chords for Ctrl and Cmd', () => {
    for (const mod of ['ctrlKey', 'metaKey']) {
      expect(k('z', { [mod]: true })).toBe('undo');
      expect(k('Z', { [mod]: true, shiftKey: true })).toBe('redo');
      expect(k('r', { [mod]: true })).toBe('redo');
    }
  });

  it('leaves reloads with Shift, plain keys and Alt chords alone', () => {
    expect(k('r', { metaKey: true, shiftKey: true })).toBeNull();
    expect(k('z')).toBeNull();
    expect(k('r')).toBeNull();
    expect(k('z', { ctrlKey: true, altKey: true })).toBeNull();
  });

  it('toggles the panel with backslash only without modifiers', () => {
    expect(k('\\')).toBe('togglePanel');
    expect(k('\\', { ctrlKey: true })).toBeNull();
  });

  it('treats text inputs and textareas as text fields, sliders not', () => {
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTextField({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextField({ tagName: 'CANVAS' })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
