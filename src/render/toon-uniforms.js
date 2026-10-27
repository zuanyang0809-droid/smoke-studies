// Uniforms shared by the two GPU toon shaders (screen-space and volume):
// the palette and the layer switches from the Style JSON.

import * as THREE from 'three';
import { makePalette, paletteToUnit } from '../core/color.js';

const V3 = () => new THREE.Vector3();

export function createToonUniforms() {
  return {
    yc: { value: [V3(), V3(), V3()] }, // young bands
    oc: { value: [V3(), V3(), V3()] }, // old bands
    bc: { value: [V3(), V3(), V3()] }, // base bands (age tint off)
    mA: { value: V3() }, mB: { value: V3() }, hz: { value: V3() }, aoc: { value: V3() },
    emb: { value: V3() }, hot: { value: V3() }, edk: { value: V3() },
    tex: { value: 0.5 },
    fHaze: { value: 1 }, fMot: { value: 1 }, fAge: { value: 1 }, fAO: { value: 1 }, fEmb: { value: 0 },
    TH: { value: 0.11 }, SH: { value: 0.42 },
  };
}

/** @returns the palette in 0..1 floats (also used for ember colors). */
export function applyToonStyle(U, style) {
  const pal = paletteToUnit(makePalette(style.color.base, style.color.hueShift));
  for (let i = 0; i < 3; i++) {
    U.yc.value[i].fromArray(pal.young[i]);
    U.oc.value[i].fromArray(pal.old[i]);
    U.bc.value[i].fromArray(pal.base[i]);
  }
  for (const k of ['mA', 'mB', 'hz', 'emb', 'hot', 'edk']) U[k].value.fromArray(pal[k]);
  U.aoc.value.fromArray(pal.ao);
  U.tex.value = style.texture.amount;
  U.fHaze.value = style.layers.haze ? 1 : 0;
  U.fMot.value = style.texture.mottle ? 1 : 0;
  U.fAge.value = style.layers.ageTint ? 1 : 0;
  U.fAO.value = style.layers.ambientOcclusion ? 1 : 0;
  U.fEmb.value = style.layers.emberCore ? 1 : 0;
  U.TH.value = style.shading.silhouetteThreshold;
  U.SH.value = style.shading.shadowThreshold;
  return pal;
}
