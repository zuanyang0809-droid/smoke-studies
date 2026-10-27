import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  defaultsFromSchema,
  getPresets,
  loadStyle,
  mergeStyle,
  presets,
  SCHEMA_ID,
  styleFromLegacySave,
  validateStyle,
} from '../src/core/style.js';

describe('defaults', () => {
  it('are derived from the schema', () => {
    expect(DEFAULT_STYLE.schema).toBe(SCHEMA_ID);
    expect(defaultsFromSchema()).toEqual(DEFAULT_STYLE);
  });

  it('match the starting controls of the 2D prototype', () => {
    expect(DEFAULT_STYLE.color).toEqual({ base: '#8a8f99', hueShift: 20, background: '#000000' });
    expect(DEFAULT_STYLE.motion).toEqual({ rise: 0.5, curl: 0.4, dissipation: 0.4, agingFrames: 80 });
    expect(DEFAULT_STYLE.form.solidity).toBe(0.4);
    expect(DEFAULT_STYLE.texture).toEqual({ amount: 0.5, mottle: true });
    expect(DEFAULT_STYLE.embers).toEqual({ enabled: true, amount: 0.4, matchSmoke: false });
    expect(DEFAULT_STYLE.timing.frameStep).toBe(2);
    expect(DEFAULT_STYLE.shading.opacity).toBe(0.92);
  });

  it('are valid', () => {
    expect(validateStyle(DEFAULT_STYLE)).toEqual({ valid: true, errors: [] });
  });

  it('are frozen at the top level', () => {
    expect(Object.isFrozen(DEFAULT_STYLE)).toBe(true);
  });
});

describe('presets', () => {
  it('are all valid on their own', () => {
    for (const p of presets) expect(validateStyle(p).errors).toEqual([]);
  });

  it('are completed with defaults by getPresets', () => {
    const all = getPresets();
    expect(all.map((p) => p.name)).toEqual(['Incense', 'Arcane smoke bomb', 'Lavender blast', 'Dust']);
    expect(all[0].motion.curl).toBe(0.3);
  });
});

describe('validateStyle', () => {
  const bad = (patch) => validateStyle(mergeStyle(DEFAULT_STYLE, patch)).errors;

  it('rejects a wrong schema id', () => {
    expect(bad({ schema: 'smoke-style/2' })).toEqual(['schema must be "smoke-style/1".']);
  });

  it('rejects malformed hex colors', () => {
    expect(bad({ color: { base: 'red' } })[0]).toMatch(/color\.base must match/);
    expect(bad({ color: { background: '#12345' } })[0]).toMatch(/color\.background/);
  });

  it('rejects out-of-range numbers', () => {
    expect(bad({ motion: { rise: 1.5 } })).toEqual(['motion.rise must be <= 1.']);
    expect(bad({ color: { hueShift: -1 } })).toEqual(['color.hueShift must be >= 0.']);
  });

  it('rejects non-integers where integers are required', () => {
    expect(bad({ timing: { frameStep: 2.5 } })).toEqual(['timing.frameStep must be an integer.']);
  });

  it('rejects wrong types and enum values', () => {
    expect(bad({ layers: { haze: 'yes' } })).toEqual(['layers.haze must be true or false.']);
    expect(bad({ emission: { mode: 'spray' } })[0]).toMatch(/emission\.mode must be one of/);
    expect(bad({ motion: { curl: '0.4' } })).toEqual(['motion.curl must be a number.']);
  });

  it('checks array length', () => {
    expect(bad({ shading: { lightDirection: [0, 1] } })).toEqual(['shading.lightDirection needs at least 3 items.']);
  });

  it('reports missing required sections', () => {
    const { color, ...rest } = DEFAULT_STYLE;
    expect(validateStyle(rest).errors).toEqual(['style.color is required.']);
  });
});

describe('mergeStyle', () => {
  it('merges nested objects and keeps other keys', () => {
    const s = mergeStyle(DEFAULT_STYLE, { motion: { rise: 0.9 } });
    expect(s.motion).toEqual({ ...DEFAULT_STYLE.motion, rise: 0.9 });
    expect(s.color).toEqual(DEFAULT_STYLE.color);
  });

  it('replaces arrays instead of merging them', () => {
    const s = mergeStyle(DEFAULT_STYLE, { shading: { lightDirection: [1, 0, 0] } });
    expect(s.shading.lightDirection).toEqual([1, 0, 0]);
  });

  it('never mutates its inputs', () => {
    const before = JSON.stringify(DEFAULT_STYLE);
    const patch = { motion: { rise: 0.1 } };
    const s = mergeStyle(DEFAULT_STYLE, patch);
    s.motion.curl = 0;
    patch.motion.rise = 0.2;
    expect(JSON.stringify(DEFAULT_STYLE)).toBe(before);
    expect(s.motion.rise).toBe(0.1);
  });

  it('ignores a non-object patch', () => {
    expect(mergeStyle(DEFAULT_STYLE, null)).toEqual(DEFAULT_STYLE);
  });
});

describe('loadStyle', () => {
  it('loads a partial style from a JSON string', () => {
    const { style, errors } = loadStyle('{"schema":"smoke-style/1","color":{"base":"#c4467f"}}');
    expect(errors).toEqual([]);
    expect(style.color.base).toBe('#c4467f');
    expect(style.motion).toEqual(DEFAULT_STYLE.motion);
  });

  it('reports invalid JSON', () => {
    const { style, errors } = loadStyle('{oops');
    expect(style).toBeNull();
    expect(errors[0]).toMatch(/^Not valid JSON/);
  });

  it('requires the schema id', () => {
    expect(loadStyle({ color: { base: '#ffffff' } }).errors).toEqual(['Set "schema" to "smoke-style/1".']);
  });

  it('returns validation errors instead of a style', () => {
    const { style, errors } = loadStyle({ schema: SCHEMA_ID, embers: { amount: 4 } });
    expect(style).toBeNull();
    expect(errors).toEqual(['embers.amount must be <= 1.']);
  });
});

describe('styleFromLegacySave', () => {
  it('maps prototype slider values onto the style', () => {
    const s = styleFromLegacySave({
      c: '#62905f', m: 'trail', st: 3, tx: 6, bu: 4, ds: 5, tb: 7, so: 8, hs: 3, ea: 0,
      hz: true, mt: false, ag: true, ao: false, em: false, sp: true, sm: true,
    });
    expect(s.color).toMatchObject({ base: '#62905f', hueShift: 12 });
    expect(s.emission.mode).toBe('livingStroke');
    expect(s.timing.frameStep).toBe(3);
    expect(s.texture).toEqual({ amount: 0.6, mottle: false });
    expect(s.motion).toMatchObject({ rise: 0.4, dissipation: 0.5, curl: 0.7 });
    expect(s.form.solidity).toBe(0.8);
    expect(s.layers).toEqual({ haze: true, ageTint: true, ambientOcclusion: false, emberCore: false });
    expect(s.embers).toEqual({ enabled: true, amount: 0, matchSmoke: true });
    expect(validateStyle(s).valid).toBe(true);
  });

  it('keeps defaults for fields an old save did not have', () => {
    const s = styleFromLegacySave({ c: '#8a8f99', m: 'brush' });
    expect(s).toEqual({ ...DEFAULT_STYLE });
  });
});
