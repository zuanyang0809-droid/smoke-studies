// Undo / redo history. The unit is one stroke (pointer down to pointer up).
// Each entry knows how to undo and redo itself; the history only keeps the
// order and the bound, so it works the same for 2D, 2.5D and 3D.
//
// An entry is { undo(), redo(), dispose?() }. `dispose` frees what the entry
// holds (a fluid snapshot, GPU textures) once it can no longer be reached.

export class History {
  /**
   * @param {number} [limit]      entries kept on the undo side
   * @param {() => void} [onChange] called after every change (enable buttons)
   */
  constructor(limit = 30, onChange = () => {}) {
    this.limit = limit;
    this.onChange = onChange;
    this.done = [];
    this.undone = [];
  }

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  /** Record a new stroke. A new stroke makes the redo side unreachable. */
  push(entry) {
    this._drop(this.undone);
    this.undone = [];
    this.done.push(entry);
    while (this.done.length > this.limit) this.done.shift().dispose?.();
    this.onChange();
  }

  /** @returns the entry that was undone, or null */
  undo() {
    const e = this.done.pop();
    if (!e) return null;
    e.undo();
    this.undone.push(e);
    this.onChange();
    return e;
  }

  /** @returns the entry that was redone, or null */
  redo() {
    const e = this.undone.pop();
    if (!e) return null;
    e.redo();
    this.done.push(e);
    this.onChange();
    return e;
  }

  clear() {
    this._drop(this.done);
    this._drop(this.undone);
    this.done = [];
    this.undone = [];
    this.onChange();
  }

  _drop(list) {
    for (const e of list) e.dispose?.();
  }
}
