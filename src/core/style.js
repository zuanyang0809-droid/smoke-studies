// Style JSON: one renderer-agnostic description of the look, shared by the
// 2D, 2.5D and 3D apps. The schema file is the single source of truth: the
// defaults and the validator below are both derived from it.

import schema from '../../styles/smoke-style.schema.json';
import presets from '../../styles/presets.json';

export const SCHEMA_ID = 'smoke-style/1';
export { schema, presets };

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Collect every `default` in the schema into a full style object. */
export function defaultsFromSchema(node = schema) {
  if (node.type === 'object' && node.properties) {
    const out = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const v = defaultsFromSchema(child);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  if ('const' in node) return node.const;
  return node.default === undefined ? undefined : clone(node.default);
}

/** The schema defaults; these equal the starting slider values of the prototypes. */
export const DEFAULT_STYLE = Object.freeze(defaultsFromSchema());

/**
 * Deep-merge `patch` onto `base` without mutating either.
 * Objects merge key by key; arrays and scalars replace.
 */
export function mergeStyle(base, patch) {
  const out = clone(base);
  if (!isObject(patch)) return out;
  for (const k in patch) {
    if (isObject(patch[k]) && isObject(out[k])) out[k] = mergeStyle(out[k], patch[k]);
    else if (patch[k] !== undefined) out[k] = clone(patch[k]);
  }
  return out;
}

// Minimal JSON Schema (draft-07 subset) validator: enough for type, const,
// enum, minimum/maximum, pattern, required, properties and array items.
function check(node, value, path, errors) {
  const where = path || 'style';
  if ('const' in node && value !== node.const) {
    errors.push(`${where} must be ${JSON.stringify(node.const)}.`);
    return;
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${where} must be one of ${node.enum.map((e) => JSON.stringify(e)).join(', ')}.`);
    return;
  }
  switch (node.type) {
    case 'object':
      if (!isObject(value)) return void errors.push(`${where} must be an object.`);
      for (const key of node.required || []) {
        if (!(key in value)) errors.push(`${where}.${key} is required.`);
      }
      for (const [key, child] of Object.entries(node.properties || {})) {
        if (key in value) check(child, value[key], path ? `${path}.${key}` : key, errors);
      }
      return;
    case 'array':
      if (!Array.isArray(value)) return void errors.push(`${where} must be an array.`);
      if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${where} needs at least ${node.minItems} items.`);
      if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${where} allows at most ${node.maxItems} items.`);
      if (node.items) value.forEach((v, i) => check(node.items, v, `${where}[${i}]`, errors));
      return;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return void errors.push(`${where} must be a number.`);
      if (node.type === 'integer' && !Number.isInteger(value)) errors.push(`${where} must be an integer.`);
      if (node.minimum !== undefined && value < node.minimum) errors.push(`${where} must be >= ${node.minimum}.`);
      if (node.maximum !== undefined && value > node.maximum) errors.push(`${where} must be <= ${node.maximum}.`);
      return;
    case 'string':
      if (typeof value !== 'string') return void errors.push(`${where} must be a string.`);
      if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${where} must match ${node.pattern}.`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${where} must be true or false.`);
      return;
  }
}

/**
 * Validate a complete style object against the schema.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStyle(style) {
  const errors = [];
  check(schema, style, '', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Load a style from a JSON string or object. Missing fields are filled from
 * the defaults, then the result is validated.
 * @returns {{ style: object | null, errors: string[] }}
 */
export function loadStyle(input, base = DEFAULT_STYLE) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch (err) {
      return { style: null, errors: [`Not valid JSON: ${err.message}`] };
    }
  }
  if (!isObject(obj)) return { style: null, errors: ['A style must be a JSON object.'] };
  if (obj.schema !== SCHEMA_ID) return { style: null, errors: [`Set "schema" to "${SCHEMA_ID}".`] };
  const style = mergeStyle(base, obj);
  const { errors } = validateStyle(style);
  return errors.length ? { style: null, errors } : { style, errors };
}

/** Presets from styles/presets.json, each completed with defaults. */
export function getPresets() {
  return presets.map((p) => mergeStyle(DEFAULT_STYLE, p));
}

/**
 * Convert a saved effect from the single-file prototypes (slider values
 * keyed by control id, stored under localStorage "smokeSaves") to a style.
 */
export function styleFromLegacySave(s) {
  const st = clone(DEFAULT_STYLE);
  const num = (k, fn) => {
    if (typeof s[k] === 'number') fn(s[k]);
  };
  const bool = (k, fn) => {
    if (typeof s[k] === 'boolean') fn(s[k]);
  };
  if (typeof s.c === 'string') st.color.base = s.c;
  st.emission.mode = s.m === 'trail' ? 'livingStroke' : 'brush';
  num('st', (v) => (st.timing.frameStep = v));
  num('tx', (v) => (st.texture.amount = v / 10));
  num('bu', (v) => (st.motion.rise = v / 10));
  num('ds', (v) => (st.motion.dissipation = v / 10));
  num('tb', (v) => (st.motion.curl = v / 10));
  num('so', (v) => (st.form.solidity = v / 10));
  num('hs', (v) => (st.color.hueShift = v * 4));
  num('ea', (v) => (st.embers.amount = v / 10));
  bool('hz', (v) => (st.layers.haze = v));
  bool('mt', (v) => (st.texture.mottle = v));
  bool('ag', (v) => (st.layers.ageTint = v));
  bool('ao', (v) => (st.layers.ambientOcclusion = v));
  bool('em', (v) => (st.layers.emberCore = v));
  bool('sp', (v) => (st.embers.enabled = v));
  bool('sm', (v) => (st.embers.matchSmoke = v));
  return st;
}
