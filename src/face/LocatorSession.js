"use strict";
const { captureNormalizedPoint } = require("./ManualInput.js");
const { validateFace, LANDMARK_KEYS } = require("./FaceMetrics.js");
const STEPS = [
  { label: "脸框左上角" }, { label: "脸框右下角" },
  { label: "画面左眼", key: "leftEye", slot: 0 }, { label: "画面右眼", key: "rightEye", slot: 0 },
  { label: "鼻尖", key: "nose", slot: 0 }, { label: "嘴中心", key: "mouth", slot: 0 },
  { label: "左脸颊", key: "faceContour", slot: 0 }, { label: "右脸颊", key: "faceContour", slot: 1 },
  { label: "左下颌", key: "jaw", slot: 0 }, { label: "右下颌", key: "jaw", slot: 1 }
];
const clone = value => JSON.parse(JSON.stringify(value));
function validPoint(p) {
  if (!p || ![p.x, p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("点选位置必须位于图片内。");
}
function normalizedBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.x < 0 || b.y < 0 ||
      b.width <= 0 || b.height <= 0 || b.x + b.width > 100 + 1e-8 || b.y + b.height > 100 + 1e-8) throw new Error("请先完成有效的人脸框。");
  return { x: b.x / 100, y: b.y / 100, width: b.width / 100, height: b.height / 100 };
}
// Coordinates use the displayed image viewport, never raw device pixels or
// thumbnail dimensions. UI stage has no padding/border/letterbox inside it.
function pointFromClient(event, rect, view) {
  if (![event.clientX, event.clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new Error("图片尚未完成布局，请稍后点选。");
  const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) throw new Error("请点击图片内部。");
  const p = { x: view.x + u * view.width, y: view.y + v * view.height };
  validPoint(p); return p;
}
function project(point, view) {
  return { x: (point.x - view.x) / view.width, y: (point.y - view.y) / view.height };
}
function fitViewport(image, view, maxWidth = 536, maxHeight = 420) {
  const w = image.width * view.width, h = image.height * view.height;
  const scale = Math.min(maxWidth / w, maxHeight / h);
  return { width: w * scale, height: h * scale };
}
class LocatorSession {
  constructor(image, manual) {
    if (![image.width, image.height].every(v => Number.isFinite(v) && v > 0)) throw new Error("定位需要有效图片尺寸。");
    const input = manual && manual.landmarksNormalized;
    if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("关键点 JSON 必须为对象。");
    for (const [key, points] of Object.entries(input)) {
      if (!LANDMARK_KEYS.includes(key) || !Array.isArray(points) || points.length > 1000) throw new Error("关键点字段或点数组无效，请先清空错误输入。");
      points.forEach(validPoint);
    }
    this.image = { width: image.width, height: image.height };
    this.state = { manual: clone(manual), step: 0, corner: null, view: { x: 0, y: 0, width: 1, height: 1 } };
    normalizedBounds(this.state.manual.boundsPercent);
    this.history = [];
  }
  select(step) {
    if (!Number.isInteger(step) || step < 0 || step >= STEPS.length) throw new Error("定位步骤无效。");
    this.state.step = step;
    if (step !== 1) this.state.corner = null;
    if (step < 2) this.overview();
  }
  overview() { this.state.view = { x: 0, y: 0, width: 1, height: 1 }; }
  zoom() {
    const b = normalizedBounds(this.state.manual.boundsPercent), margin = .12;
    const x = Math.max(0, b.x - b.width * margin), y = Math.max(0, b.y - b.height * margin);
    this.state.view = { x, y, width: Math.min(1, b.x + b.width * (1 + margin)) - x,
      height: Math.min(1, b.y + b.height * (1 + margin)) - y };
  }
  click(point) {
    validPoint(point);
    const next = clone(this.state), previous = clone(this.state), step = next.step;
    if (step === null) throw new Error("已完成八点。选择上方位置按钮可重新点选。");
    if (step === 0) { next.corner = { ...point }; next.step = 1; }
    else if (step === 1) {
      if (!next.corner) throw new Error("请先点击脸框左上角。");
      const x = Math.min(next.corner.x, point.x), y = Math.min(next.corner.y, point.y);
      const width = Math.abs(next.corner.x - point.x), height = Math.abs(next.corner.y - point.y);
      if (width < .02 || height < .02) throw new Error("脸框过小，请框住完整人脸。");
      next.manual = { boundsPercent: { x: x * 100, y: y * 100, width: width * 100, height: height * 100 }, landmarksNormalized: {} };
      next.corner = null; next.step = 2;
    } else {
      const b = normalizedBounds(next.manual.boundsPercent), s = STEPS[step];
      if (point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height) throw new Error("关键点必须位于脸框内；可重新画脸框。");
      next.manual.landmarksNormalized = captureNormalizedPoint(next.manual.landmarksNormalized || {}, s.key, s.slot, point);
      const order = [...Array(STEPS.length - 2)].map((_, i) => 2 + (step - 1 + i) % (STEPS.length - 2));
      next.step = order.find(i => !this.has(i, next)) || null;
    }
    this.history.push(previous); this.state = next;
    if (step === 1) this.zoom();
  }
  has(step, state = this.state) {
    const s = STEPS[step];
    return step < 2 ? true : !!((state.manual.landmarksNormalized || {})[s.key] || [])[s.slot];
  }
  undo() { if (this.history.length) this.state = this.history.pop(); }
  complete() { return !this.state.corner && STEPS.every((_, i) => this.has(i)); }
  result() {
    if (!this.complete()) throw new Error("请先完成双眼、鼻、嘴、左右脸颊及下颌八个关键点。");
    const manual = clone(this.state.manual), b = normalizedBounds(manual.boundsPercent), im = this.image;
    const landmarks = Object.fromEntries(Object.entries(manual.landmarksNormalized || {}).map(([key, points]) =>
      [key, points.map(p => ({ x: p.x * im.width, y: p.y * im.height }))]));
    validateFace({ bounds: { x: b.x * im.width, y: b.y * im.height, width: b.width * im.width, height: b.height * im.height }, landmarks }, im);
    return manual;
  }
}
module.exports = { LocatorSession, STEPS, normalizedBounds, pointFromClient, project, fitViewport };
