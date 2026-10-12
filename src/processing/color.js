"use strict";
const { maskWeight } = require("./faceMask.js");
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
// Display-encoded sRGB luma estimate, NOT physical linear-light luminance.
const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
function rgb(data, i) {
  const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
  const y = luma(r, g, b);
  return { r, g, b, y, u: r - y, v: b - y };
}
function roi(pixels, mask) {
  const b = mask.bounds, o = pixels.origin;
  return { x0: Math.max(0, Math.floor(b.x - o.x)), x1: Math.min(pixels.width, Math.ceil(b.x + b.width - o.x)),
    y0: Math.max(0, Math.floor(b.y - o.y)), y1: Math.min(pixels.height, Math.ceil(b.y + b.height - o.y)) };
}
function validate(pixels) {
  if (!(pixels.data instanceof Uint8Array) || ![3, 4].includes(pixels.components) ||
      pixels.data.length !== pixels.width * pixels.height * pixels.components) throw new Error("色彩处理需要 RGB/RGBA 8 位像素缓冲。");
}
function planColor(parameters, key, mask) {
  return { implemented: true, requested: parameters[key], strength: parameters[key] * parameters.strength / 10000,
    available: mask.available, active: false, mask, reason: mask.reason || "" };
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * fraction)];
}
async function statistics(pixels, plan, checkpoint) {
  validate(pixels);
  if (!plan.strength || !plan.available) return { reason: plan.reason || "强度为零" };
  // Preserve native profile and exact outside pixels. Other profiles need a
  // separately verified color-managed path; never treat P3/Adobe RGB as sRGB.
  if (!/^sRGB IEC61966-2\.1$/i.test((pixels.colorProfile || "").trim())) {
    return { reason: "肤质/色调当前仅支持 sRGB IEC61966-2.1；已保留原配置并跳过该步骤" };
  }
  const box = roi(pixels, plan.mask), ys = [], us = [], vs = [];
  const step = Math.max(1, Math.floor(Math.min(plan.mask.bounds.width, plan.mask.bounds.height) / 64));
  for (let y = box.y0; y < box.y1; y += step) {
    if (checkpoint) await checkpoint(.1 * (y - box.y0) / Math.max(1, box.y1 - box.y0));
    for (let x = box.x0; x < box.x1; x += step) {
      if (maskWeight(x + pixels.origin.x + .5, y + pixels.origin.y + .5, plan.mask) < .25) continue;
      const c = rgb(pixels.data, (y * pixels.width + x) * pixels.components);
      if (c.y < .04 || c.y > .97) continue;
      ys.push(c.y); us.push(c.u); vs.push(c.v);
    }
  }
  if (ys.length < 24) return { reason: "有效双颊采样不足，已跳过肤质/色调；请检查定位或使用更高分辨率照片" };
  const median = percentile(ys, .5), u = percentile(us, .5), v = percentile(vs, .5);
  return { count: ys.length, median, p10: percentile(ys, .1), p90: percentile(ys, .9), u, v,
    sigmaU: Math.max(.025, percentile(us.map(x => Math.abs(x - u)), .5) * 2.5),
    sigmaV: Math.max(.025, percentile(vs.map(x => Math.abs(x - v)), .5) * 2.5) };
}
function confidence(c, stats) {
  const color = Math.exp(-.5 * (((c.u - stats.u) / stats.sigmaU) ** 2 + ((c.v - stats.v) / stats.sigmaV) ** 2));
  return color * clamp((c.y - (stats.p10 - .08)) / .08) * clamp(((stats.p90 + .08) - c.y) / .08);
}
function finish(output, changedPixels, stats) {
  return { data: output, applied: changedPixels > 0, changedPixels, stats };
}
module.exports = { clamp, luma, rgb, roi, validate, planColor, statistics, confidence, finish };
