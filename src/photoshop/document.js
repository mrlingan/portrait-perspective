"use strict";
const { app, core, constants, imaging } = require("photoshop");
const log = require("../log.js");
const MAX_PIXELS = 24000000;

function getActiveDocument() {
  if (!app.documents.length) throw new Error("请先在 Photoshop 中打开一张照片。");
  return app.activeDocument;
}
function describeDocument(doc) {
  return { id: doc.id, width: doc.width, height: doc.height, title: doc.title };
}
function validateDocument(doc) {
  if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.putPixels !== "function") {
    throw new Error("当前 Photoshop 没有可用的 Imaging API，请使用 Photoshop 25.0 或更新版本。");
  }
  if (doc.mode !== constants.DocumentMode.RGB || doc.bitsPerChannel !== constants.BitsPerChannelType.EIGHT) {
    throw new Error("当前版本仅支持 RGB、8 位/通道。请在照片副本中转换后测试。");
  }
  if (doc.width * doc.height > MAX_PIXELS) throw new Error("当前版本单次处理上限为 2400 万像素；请用缩小的照片副本测试。");
}
function validateSourceLayer(doc, layer) {
  if (!layer || layer.kind !== constants.LayerKind.NORMAL) throw new Error("请选择一个普通像素图层（背景图层也可以）；智能对象、文字、组暂不支持。");
  if (layer.parent) throw new Error("当前版本请选择顶层照片图层，暂不支持嵌套组内图层。");
  if (!layer.visible || layer.opacity !== 100 || layer.fillOpacity !== 100 || layer.blendMode !== constants.BlendMode.NORMAL) {
    throw new Error("当前版本需要可见、正常混合、100% 不透明度和填充的照片图层。");
  }
  if (Array.from(doc.layers).some(l => l.isClippingMask)) throw new Error("当前版本暂不处理含顶层剪贴关系的文档，请用普通照片副本测试。");
  const b = layer.boundsNoEffects;
  const area = (b.right - b.left) * (b.bottom - b.top);
  if (area <= 0 || area > MAX_PIXELS) throw new Error("源图层为空或超出 2400 万像素内存预算。");
  if (b.left > 0 || b.top > 0 || b.right < doc.width || b.bottom < doc.height) {
    throw new Error("当前版本需要覆盖画布的照片图层，暂不支持局部透明素材。");
  }
}
async function withHistory(doc, name, operation) {
  const documentID = doc.id;
  return core.executeAsModal(async context => {
    if (getActiveDocument().id !== documentID) throw new Error("当前文档已切换，请重试。");
    const suspension = await context.hostControl.suspendHistory({ documentID, name });
    try {
      const result = await operation(context);
      if (context.isCancelled) throw new Error("处理已取消。");
      await context.hostControl.resumeHistory(suspension, true);
      return result;
    } catch (error) {
      // Roll back only this transaction, never jump across unrelated user edits.
      try { await context.hostControl.resumeHistory(suspension, false); }
      catch (rollbackError) { log.error("显式回滚未完成；modal 异常退出将交由宿主回滚", rollbackError); }
      throw error;
    }
  }, { commandName: name });
}
module.exports = { MAX_PIXELS, getActiveDocument, describeDocument, validateDocument, validateSourceLayer, withHistory };
