"use strict";
const { inverseMap } = require("./geometry.js");

// Host-independent full-resolution RGB/RGBA 8-bit renderer. Full-buffer copy
// preserves pixels outside active support exactly; no downsampled preview is committed.
async function renderWarp({ data, width, height, components, origin, plan, checkpoint }) {
  if (!(data instanceof Uint8Array) || ![3, 4].includes(components) || data.length !== width * height * components) {
    throw new Error("当前版本仅支持 8-bit RGB/RGBA 像素缓冲。");
  }
  const output = new Uint8Array(data);
  if (!plan.active) return output;
  const b = plan.bounds;
  const x0 = Math.max(0, Math.floor(b.x - origin.x));
  const x1 = Math.min(width, Math.ceil(b.x + b.width - origin.x));
  const y0 = Math.max(0, Math.floor(b.y - origin.y));
  const y1 = Math.min(height, Math.ceil(b.y + b.height - origin.y));
  for (let y = y0; y < y1; y++) {
    if ((y - y0) % 32 === 0 && checkpoint) await checkpoint((y - y0) / Math.max(1, y1 - y0));
    for (let x = x0; x < x1; x++) {
      const dx = x + origin.x + 0.5;
      const dy = y + origin.y + 0.5;
      const mapped = inverseMap(dx, dy, plan);
      if (mapped.x === dx && mapped.y === dy) continue;
      const sx = Math.max(0, Math.min(width - 1, mapped.x - origin.x - 0.5));
      const sy = Math.max(0, Math.min(height - 1, mapped.y - origin.y - 0.5));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const tx = sx - ix, ty = sy - iy;
      const indices = [iy * width + ix, iy * width + Math.min(ix + 1, width - 1),
        Math.min(iy + 1, height - 1) * width + ix, Math.min(iy + 1, height - 1) * width + Math.min(ix + 1, width - 1)];
      const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      const outIndex = (y * width + x) * components;
      const alpha = components === 4 ? indices.reduce((sum, i, j) => sum + data[i * 4 + 3] * weights[j], 0) : 255;
      for (let c = 0; c < 3; c++) {
        const sum = indices.reduce((acc, i, j) => acc + data[i * components + c] * weights[j] *
          (components === 4 ? data[i * 4 + 3] / 255 : 1), 0);
        output[outIndex + c] = alpha > 0 ? Math.round(sum * 255 / alpha) : 0;
      }
      if (components === 4) output[outIndex + 3] = Math.round(alpha);
    }
  }
  return output;
}
module.exports = { renderWarp };
