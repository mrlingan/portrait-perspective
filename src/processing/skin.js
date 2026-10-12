"use strict";
const { maskWeight } = require("./faceMask.js");
const { clamp, luma, rgb, roi, planColor, statistics, confidence, finish } = require("./color.js");
const planSkin = (parameters, mask) => planColor(parameters, "skin", mask);
async function renderSkin(pixels, plan, checkpoint) {
  const stats = await statistics(pixels, plan, checkpoint);
  if (stats.reason) return { data: pixels.data, applied: false, changedPixels: 0, reason: stats.reason };
  const output = new Uint8Array(pixels.data), box = roi(pixels, plan.mask);
  // Radius scales with face width. Integer offsets are pixel-grid quantization.
  // Bilateral chroma filtering retains the original encoded luma detail.
  const radius = plan.mask.bounds.width * .012, taps = [];
  for (let ty = -2; ty <= 2; ty++) for (let tx = -2; tx <= 2; tx++) taps.push({
    dx: Math.round(tx * radius / 2), dy: Math.round(ty * radius / 2), spatial: Math.exp(-(tx * tx + ty * ty) / 3) });
  let changed = 0;
  for (let y = box.y0; y < box.y1; y++) {
    if ((y - box.y0) % 16 === 0 && checkpoint) await checkpoint(.1 + .9 * (y - box.y0) / Math.max(1, box.y1 - box.y0));
    for (let x = box.x0; x < box.x1; x++) {
      const m = maskWeight(x + pixels.origin.x + .5, y + pixels.origin.y + .5, plan.mask);
      if (!m) continue;
      const i = (y * pixels.width + x) * pixels.components, center = rgb(pixels.data, i);
      const blend = .7 * plan.strength * m * confidence(center, stats);
      if (blend < .001) continue;
      let total = 0, r = 0, g = 0, b = 0;
      for (const t of taps) {
        const nx = clamp(x + t.dx, 0, pixels.width - 1), ny = clamp(y + t.dy, 0, pixels.height - 1);
        const c = rgb(pixels.data, (ny * pixels.width + nx) * pixels.components);
        const nm = maskWeight(nx + pixels.origin.x + .5, ny + pixels.origin.y + .5, plan.mask);
        const range = Math.exp(-.5 * (((c.y - center.y) / .035) ** 2 +
          ((c.u - center.u) / .06) ** 2 + ((c.v - center.v) / .06) ** 2));
        const a = t.spatial * range * nm;
        total += a; r += c.r * a; g += c.g * a; b += c.b * a;
      }
      if (!total) continue;
      r = r / total - center.r; g = g / total - center.g; b = b / total - center.b;
      const dy = luma(r, g, b), delta = [r - dy, g - dy, b - dy];
      const limit = Math.min(1, .06 / Math.max(...delta.map(Math.abs), 1e-12));
      const channels = [center.r, center.g, center.b];
      for (let c = 0; c < 3; c++) output[i + c] = Math.round(clamp(channels[c] + delta[c] * limit * blend) * 255);
      if (output[i] !== pixels.data[i] || output[i + 1] !== pixels.data[i + 1] || output[i + 2] !== pixels.data[i + 2]) changed++;
    }
  }
  return finish(output, changed, stats);
}
module.exports = { planSkin, renderSkin };
