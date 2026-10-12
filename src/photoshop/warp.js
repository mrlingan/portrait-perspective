"use strict";
const { imaging } = require("photoshop");
const { renderWarp } = require("../processing/resample.js");
const { MAX_PIXELS } = require("./document.js");

async function readSource(doc, source) {
  const result = await imaging.getPixels({ documentID: doc.id, layerID: source.id, componentSize: 8, applyAlpha: false });
  try {
    const image = result.imageData;
    if (result.level !== 0 || image.width * image.height > MAX_PIXELS || image.colorSpace !== "RGB" || image.componentSize !== 8) {
      throw new Error("无法取得预算内的原始分辨率 RGB 8 位像素。");
    }
    const data = await image.getData({ chunky: true });
    const b = result.sourceBounds;
    if (!b || !Number.isFinite(b.left) || !Number.isFinite(b.top) ||
        b.left > 0 || b.top > 0 || b.right < doc.width || b.bottom < doc.height ||
        b.right - b.left !== image.width || b.bottom - b.top !== image.height) {
      throw new Error("源像素范围与画布不匹配；暂不支持空图层、部分覆盖或缩放缓冲。");
    }
    // Duplicating translucent pixels over their original changes compositing.
    // V1 rejects them rather than hiding/mutating the original or silently baking.
    if (image.components === 4) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) throw new Error("当前版本暂不支持带透明像素的照片图层。");
      }
    }
    return { data, width: image.width, height: image.height, components: image.components,
      colorProfile: image.colorProfile, origin: { x: b.left, y: b.top } };
  } finally { result.imageData.dispose(); }
}
function checkpoint(context, start, end) {
  return async fraction => {
    if (context.isCancelled) throw new Error("处理已取消。");
    context.reportProgress({ value: start + fraction * (end - start) });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (context.isCancelled) throw new Error("处理已取消。");
  };
}
async function writeWarp(doc, target, sourcePixels, plan, context) {
  const output = await renderWarp({ ...sourcePixels, plan, checkpoint: checkpoint(context, 0, .35) });
  await writePixels(doc, target, sourcePixels, output, context);
  return output;
}
async function writePixels(doc, target, sourcePixels, output, context) {
  let image;
  try {
    const options = { width: sourcePixels.width, height: sourcePixels.height, components: sourcePixels.components, colorSpace: "RGB", chunky: true };
    if (sourcePixels.colorProfile) options.colorProfile = sourcePixels.colorProfile;
    image = await imaging.createImageDataFromBuffer(output, options);
    if (context.isCancelled) throw new Error("处理已取消。");
    await imaging.putPixels({ documentID: doc.id, layerID: target.id, imageData: image,
      replace: true, targetBounds: { left: sourcePixels.origin.x, top: sourcePixels.origin.y } });
  } finally { if (image) image.dispose(); }
}
module.exports = { readSource, writeWarp, writePixels, checkpoint };
