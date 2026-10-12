"use strict";
const SCHEMA = [
  { key: "strength", label: "整体强度", min: 0, max: 100, value: 35, implemented: true },
  { key: "faceWidth", label: "脸宽", min: -50, max: 50, value: -12, implemented: true },
  { key: "cheek", label: "脸颊", min: -50, max: 50, value: -8, implemented: true },
  { key: "jaw", label: "下颌", min: -50, max: 50, value: -6, implemented: true },
  { key: "eyes", label: "眼部", min: -30, max: 30, value: 0, implemented: true },
  { key: "nose", label: "鼻部", min: -30, max: 30, value: -4, implemented: true },
  { key: "skin", label: "肤质", min: 0, max: 100, value: 30, implemented: true },
  { key: "tone", label: "色调", min: 0, max: 100, value: 20, implemented: true }
];
const REFERENCE_STYLE = Object.fromEntries(SCHEMA.map(s => [s.key, s.value]));
function normalizeParameters(input) {
  const result = {};
  for (const spec of SCHEMA) {
    const value = input[spec.key] === undefined ? spec.value : input[spec.key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${spec.label} 参数无效。`);
    result[spec.key] = Math.max(spec.min, Math.min(spec.max, value));
  }
  return result;
}
module.exports = { SCHEMA, REFERENCE_STYLE, normalizeParameters };
