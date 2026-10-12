"use strict";
const { maskWeight } = require("./faceMask.js");
const { clamp, rgb, roi, planColor, statistics, confidence, finish } = require("./color.js");
const planTone = (parameters, mask) => planColor(parameters, "tone", mask);
async function renderTone(pixels, plan, checkpoint) {
  const stats = await statistics(pixels, plan, checkpoint);
  if (stats.reason) return { data: pixels.data, applied: false, changedPixels: 0, reason: stats.reason };
  const output = new Uint8Array(pixels.data), box = roi(pixels, plan.mask);
  const lift = Math.min(.035, (stats.median - stats.p10) * .14);
  const lower = Math.min(.045, (stats.p90 - stats.median) * .14);
  let changed = 0;
  for (let y = box.y0; y < box.y1; y++) {
    if ((y - box.y0) % 32 === 0 && checkpoint) await checkpoint(.1 + .9 * (y - box.y0) / Math.max(1, box.y1 - box.y0));
    for (let x = box.x0; x < box.x1; x++) {
      const m = maskWeight(x + pixels.origin.x + .5, y + pixels.origin.y + .5, plan.mask);
      if (!m) continue;
      const i = (y * pixels.width + x) * pixels.components, c = rgb(pixels.data, i);
      const shadow = clamp((stats.median - c.y) / Math.max(.01, stats.median - stats.p10));
      const highlight = clamp((c.y - stats.median) / Math.max(.01, stats.p90 - stats.median));
      const delta = (lift * shadow - lower * highlight) * plan.strength * m * confidence(c, stats);
      // Equal RGB delta preserves channel differences, except clipping/rounding.
      for (let k = 0; k < 3; k++) output[i + k] = Math.round(clamp(pixels.data[i + k] / 255 + delta) * 255);
      if (output[i] !== pixels.data[i] || output[i + 1] !== pixels.data[i + 1] || output[i + 2] !== pixels.data[i + 2]) changed++;
    }
  }
  return finish(output, changed, stats);
}
module.exports = { planTone, renderTone };
