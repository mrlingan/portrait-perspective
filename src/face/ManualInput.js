"use strict";
const { LANDMARK_KEYS } = require("./FaceMetrics.js");

// Read-only selection capture. A small rectangle is centered on a real feature
// by the user; its center becomes an anchor, not a model-detected landmark.
function selectionPoint(bounds, image) {
  if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) throw new Error("请先用小矩形选框框住要记录的位置。");
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > image.width || bounds.bottom > image.height) {
    throw new Error("关键点选框必须完整位于画布内。");
  }
  return { x: (bounds.left + bounds.right) / (2 * image.width), y: (bounds.top + bounds.bottom) / (2 * image.height) };
}
function captureNormalizedPoint(input, key, slot, point) {
  if (!point || ![point.x, point.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("关键点必须为画面归一化坐标 0–1。");
  if (!LANDMARK_KEYS.includes(key) || ![0, 1].includes(slot)) throw new Error("关键点目标无效。");
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("关键点 JSON 必须为对象。");
  const points = input[key] || [];
  if (!Array.isArray(points)) throw new Error(`${key} 必须为点数组。`);
  if (slot > points.length) throw new Error("请先记录画面左侧点，再记录右侧点。");
  const copy = [...points];
  copy[slot] = { x: point.x, y: point.y };
  return { ...input, [key]: copy };
}
function capturePoint(input, key, slot, bounds, image) {
  return captureNormalizedPoint(input, key, slot, selectionPoint(bounds, image));
}
module.exports = { selectionPoint, capturePoint, captureNormalizedPoint };
