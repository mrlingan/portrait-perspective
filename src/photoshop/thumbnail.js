"use strict";
const { core, imaging } = require("photoshop");
const { getActiveDocument, validateDocument, validateSourceLayer, describeDocument } = require("./document.js");
const { validatePlainLayer, findLayer } = require("./layers.js");
// Display only. Small color-managed JPEG; never used as processing input, never
// saved to disk/network. Geometry/skin processing still reads original pixels.
async function readThumbnail(doc, source) {
  if (typeof imaging.encodeImageData !== "function") throw new Error("宿主不支持预览图编码，请使用 Photoshop 选区定位。");
  return core.executeAsModal(async context => {
    if (getActiveDocument().id !== doc.id) throw new Error("文档已切换，请重新打开定位窗口。");
    validateDocument(doc);
    source = findLayer(doc, source.id); validateSourceLayer(doc, source);
    await validatePlainLayer(doc, source);
    const result = await imaging.getPixels({ documentID: doc.id, layerID: source.id,
      sourceBounds: { left: 0, top: 0, right: doc.width, bottom: doc.height },
      targetSize: doc.width >= doc.height ? { width: Math.min(1200, doc.width) } : { height: Math.min(1200, doc.height) },
      colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8, applyAlpha: true });
    try {
      if (context.isCancelled) throw new Error("读取预览已取消。");
      const im = result.imageData, b = result.sourceBounds, scale = 2 ** result.level;
      // Thumbnail bounds are in cache-level coordinates. Refuse a trimmed layer;
      // using it as a full-canvas image would shift all recorded landmarks.
      if (!b || !Number.isFinite(scale) || b.left !== 0 || b.top !== 0 ||
          Math.abs(b.right * scale - doc.width) > scale || Math.abs(b.bottom * scale - doc.height) > scale ||
          im.width <= 0 || im.height <= 0 || im.width * im.height > 1500000) throw new Error("无法取得覆盖完整画布的定位预览。");
      const encoded = await imaging.encodeImageData({ imageData: im, base64: true });
      if (context.isCancelled) throw new Error("读取预览已取消。");
      if (typeof encoded !== "string" || !encoded.length) throw new Error("宿主没有返回有效预览 JPEG。");
      return { ...describeDocument(doc), sourceID: source.id, previewWidth: im.width, previewHeight: im.height,
        dataURL: `data:image/jpeg;base64,${encoded}` };
    } finally { result.imageData.dispose(); }
  }, { commandName: "Portrait Perspective · Read locator preview" });
}
module.exports = { readThumbnail };
