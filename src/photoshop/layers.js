"use strict";
const { action, constants } = require("photoshop");

function findLayer(doc, id) {
  function walk(layers) {
    for (const layer of layers) {
      if (layer.id === id) return layer;
      if (layer.kind === constants.LayerKind.GROUP) {
        const found = walk(layer.layers);
        if (found) return found;
      }
    }
    return null;
  }
  return id == null ? null : walk(doc.layers);
}
async function checkedBatchPlay(commands) {
  const results = await action.batchPlay(commands, {});
  const failure = results.find(r => r && r._obj === "error");
  if (failure) throw new Error(failure.message || `Photoshop action 失败 (${failure.result})`);
  return results;
}
async function validatePlainLayer(doc, layer) {
  // DOM does not expose mask/style presence. A development-only get-all query
  // is deliberately isolated here; Phase 2 can replace with verified multiGet.
  const [descriptor] = await checkedBatchPlay([{
    _obj: "get", _target: [{ _ref: "layer", _id: layer.id }, { _ref: "document", _id: doc.id }]
  }]);
  if (!descriptor || descriptor.hasUserMask === undefined || descriptor.hasVectorMask === undefined) {
    throw new Error("宿主未返回预期的图层蒙版信息，已停止处理。请在 UDT Console 检查宿主兼容性。");
  }
  if (descriptor.hasUserMask || descriptor.hasVectorMask || descriptor.layerEffects || descriptor.filterFX) {
    throw new Error("当前版本暂不支持蒙版、图层样式或智能滤镜。请使用无附加效果的照片副本。");
  }
}
async function selectLayer(doc, id) {
  // activeLayers setter only arrived in PS 26.9. Use ActionJSON on PS 25+.
  await checkedBatchPlay([{
    _obj: "select", _target: [{ _ref: "layer", _id: id }, { _ref: "document", _id: doc.id }],
    makeVisible: false, _options: { dialogOptions: "dontDisplay" }
  }]);
}
async function createCorrection(doc, source, preview) {
  const geometry = await source.duplicate();
  geometry.allLocked = false;
  geometry.pixelsLocked = false;
  geometry.positionLocked = false;
  geometry.transparentPixelsLocked = false;
  geometry.name = "Geometry";
  const group = await doc.createLayerGroup({
    name: preview ? "Portrait Correction [Preview]" : "Portrait Correction",
    fromLayers: [geometry], blendMode: constants.BlendMode.NORMAL
  });
  return { group, geometry };
}
async function createStage(previous, group, name) {
  const layer = await previous.duplicate();
  if (!layer.parent || layer.parent.id !== group.id) throw new Error("宿主没有将阶段副本放在处理组内，已停止并回滚。");
  layer.name = name;
  return layer;
}
function getOwnedGroup(doc, session) {
  // Keep all committed versions: Undo of a replacement resurrects an earlier ID.
  const live = [];
  for (const version of session.versions || []) {
    const group = findLayer(doc, version.groupID);
    const ids = version.stageIDs || [version.geometryID];
    if (!group && !ids.some(id => findLayer(doc, id))) continue;
    if (!group || group.kind !== constants.LayerKind.GROUP || group.layers.length !== ids.length ||
        !Array.from(group.layers).every(layer => ids.includes(layer.id))) {
      throw new Error("处理组的内容已被修改。为保留新增内容，请手动整理该组后重新分析。");
    }
    live.push(group);
  }
  if (live.length > 1) throw new Error("检测到多个本会话处理结果，请先在图层面板整理后再处理。");
  return live[0] || null;
}
async function deleteCorrection(doc, group, session) {
  // Photoshop 27.0 can remove the group container while leaving its pixels as
  // top-level layers. Delete verified owned children, then the empty group.
  const owned = getOwnedGroup(doc, session);
  if (!owned || owned.id !== group.id) throw new Error("处理组的内容已被修改，停止删除。");
  const groupID = group.id, ids = Array.from(group.layers, layer => layer.id);
  for (const id of ids) await findLayer(doc, id).delete();
  const empty = findLayer(doc, groupID);
  if (empty) await empty.delete();
  if (findLayer(doc, groupID) || ids.some(id => findLayer(doc, id))) throw new Error("宿主未完整移除处理结果，已停止并回滚。");
}
module.exports = { findLayer, validatePlainLayer, selectLayer, createCorrection, createStage, getOwnedGroup, deleteCorrection };
