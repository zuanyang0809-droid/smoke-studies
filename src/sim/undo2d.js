// Undo entries for one stroke on a 2D smoke layer (2D and 2.5D studies).
//   living stroke  undo takes it off the layer (its smoke fades on its own),
//                  redo puts it back
//   brush stroke   undo restores the fluid as it was when the stroke began,
//                  redo replays the recorded points into the current fluid

import { replayStroke2D } from './emitters.js';

/**
 * Build the entry right after `emitter.begin(layer, p, frame)`.
 * @param {import('./layer2d.js').SmokeLayer2D} layer
 * @param {import('./emitters.js').Emitter2D} emitter
 * @param {ReturnType<import('./fluid2d.js').Fluid2D['snapshot']>} before  taken just before begin
 * @param {{x: number, y: number}} p  the first point
 * @param {() => number} getFrame
 * @returns {{ record: (p: {x: number, y: number}) => void, undo: () => void, redo: () => void }}
 */
export function strokeEntry2D(layer, emitter, before, p, getFrame) {
  if (emitter.stroke) {
    const stroke = emitter.stroke;
    return {
      record() {},
      undo: () => layer.removeStroke(stroke),
      redo: () => layer.addStroke(stroke),
    };
  }
  const points = [p], rgb = emitter.rgb.slice();
  let snap = before;
  return {
    record: (q) => points.push(q),
    undo: () => layer.restore(snap),
    redo() {
      snap = layer.fluid.snapshot();
      replayStroke2D(layer, points, rgb, getFrame());
    },
  };
}
