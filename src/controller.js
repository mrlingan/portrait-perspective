"use strict";
const documents = require("./photoshop/document.js");
const layers = require("./photoshop/layers.js");
const { readSource, writeWarp, writePixels, checkpoint } = require("./photoshop/warp.js");
const { FaceAnalyzer, ManualFaceAdapter } = require("./face/FaceAnalyzer.js");
const { createPipeline } = require("./processing/pipeline.js");
const { renderSkin } = require("./processing/skin.js");
const { renderTone } = require("./processing/tone.js");
const { readThumbnail } = require("./photoshop/thumbnail.js");
const log = require("./log.js");

class PortraitController {
  constructor(analyzer = new FaceAnalyzer(new ManualFaceAdapter())) {
    this.analyzer = analyzer;
    this.sessions = new Map(); // IDs scoped to this plugin session and document.
  }
  async inputSource() {
    const doc = documents.getActiveDocument();
    documents.validateDocument(doc);
    const old = this.sessions.get(doc.id);
    if (old && layers.getOwnedGroup(doc, old)) throw new Error("请先恢复当前处理组，再重新分析人脸。");
    if (doc.activeLayers.length !== 1) throw new Error("请只选择一个原始照片图层。");
    const source = doc.activeLayers[0];
    documents.validateSourceLayer(doc, source);
    await layers.validatePlainLayer(doc, source);
    const image = documents.describeDocument(doc);
    return { doc, source, image, old };
  }
  async thumbnail() {
    const { doc, source } = await this.inputSource();
    const image = await readThumbnail(doc, source);
    log.info("定位预览已读取", { documentID: doc.id, sourceID: source.id, width: image.previewWidth, height: image.previewHeight });
    return image;
  }
  async analyze(manual) {
    const { doc, source, image, old } = await this.inputSource();
    const face = await this.analyzer.analyze({ image, manual });
    // Bind analysis to the actual source and document dimensions; no global face.
    this.sessions.set(doc.id, { documentID: doc.id, sourceID: source.id, image, face, versions: old ? old.versions : [] });
    log.info("人脸分析完成", { adapter: face.provenance.adapter, document: image, sourceID: source.id, face });
    return face;
  }
  async process(parameters, preview) {
    const doc = documents.getActiveDocument();
    const session = this.sessions.get(doc.id);
    if (!session) throw new Error("请先定位并分析当前文档的人脸。");
    const pipeline = createPipeline(session.face, parameters);
    log.info(preview ? "开始预览" : "开始应用", pipeline);
    const result = await documents.withHistory(doc, preview ? "Portrait Perspective · Preview" : "Portrait Perspective · Apply", async context => {
      documents.validateDocument(doc);
      if (doc.width !== session.image.width || doc.height !== session.image.height) throw new Error("文档尺寸已改变，请恢复后重新分析。");
      const source = layers.findLayer(doc, session.sourceID);
      documents.validateSourceLayer(doc, source);
      await layers.validatePlainLayer(doc, source);
      const oldGroup = layers.getOwnedGroup(doc, session);
      // Read before deleting old result. Failure leaves the last good result intact.
      const pixels = await readSource(doc, source);
      if (context.isCancelled) throw new Error("处理已取消。");
      if (oldGroup) await layers.deleteCorrection(doc, oldGroup, session);
      const created = await layers.createCorrection(doc, source, preview);
      let data = await writeWarp(doc, created.geometry, pixels, pipeline.geometry, context);
      let previous = created.geometry;
      const stageIDs = [previous.id];
      // Opaque cumulative snapshots: each visible top stage includes earlier
      // stages. They are raster copies, not independent adjustment/filter layers.
      const stages = [["skin", "Skin", renderSkin, .35, .7], ["tone", "Tone", renderTone, .7, .95]];
      for (const [key, name, render, start, end] of stages) {
        const plan = pipeline[key];
        if (!plan.strength || !plan.available) continue;
        const output = await render({ ...pixels, data }, plan, checkpoint(context, start, end));
        plan.active = output.applied;
        plan.changedPixels = output.changedPixels;
        plan.statistics = output.stats || null;
        if (output.reason) pipeline.warnings.push(`${key}: 已跳过；${output.reason}`);
        if (!output.applied) {
          if (!output.reason) pipeline.warnings.push(`${key}: 未产生 8 位像素变化，本次不建立该阶段图层`);
          continue;
        }
        const layer = await layers.createStage(previous, created.group, name);
        await writePixels(doc, layer, pixels, output.data, context);
        stageIDs.push(layer.id); previous = layer; data = output.data;
      }
      pipeline.active = pipeline.geometry.active || pipeline.skin.active || pipeline.tone.active;
      await layers.selectLayer(doc, created.group.id);
      context.reportProgress({ value: 1 });
      return { groupID: created.group.id, geometryID: created.geometry.id, stageIDs };
    });
    // Only publish IDs after Photoshop has committed the history suspension.
    Object.assign(session, result, { preview });
    session.versions.push(result);
    log.info("处理完成；源图层未修改", { documentID: doc.id, ...result,
      skinChangedPixels: pipeline.skin.changedPixels || 0, toneChangedPixels: pipeline.tone.changedPixels || 0,
      warnings: pipeline.warnings });
    return pipeline;
  }
  async reset() {
    const doc = documents.getActiveDocument();
    const session = this.sessions.get(doc.id);
    if (!session) return false;
    let removed = false;
    await documents.withHistory(doc, "Portrait Perspective · Reset", async () => {
      const group = layers.getOwnedGroup(doc, session);
      if (group) { await layers.deleteCorrection(doc, group, session); removed = true; }
      if (layers.findLayer(doc, session.sourceID)) await layers.selectLayer(doc, session.sourceID);
    });
    // Retain ownership IDs so Undo of Reset / Redo is recognised during session.
    log.info("恢复完成", { documentID: doc.id, removed });
    return removed;
  }
}
module.exports = { PortraitController };
