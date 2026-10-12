"use strict";
const { PortraitController } = require("./src/controller.js");
const { createControls } = require("./src/ui/controls.js");
const { createLocator } = require("./src/ui/locator.js");
const { getActiveDocument, describeDocument } = require("./src/photoshop/document.js");
const log = require("./src/log.js");
const { entrypoints } = require("uxp");

function initialize() {
  const ui = createControls();
  const controller = new PortraitController();
  const locator = createLocator();
  let busy = false;
  let analysisDirty = false;
  function documentInfo() {
    const doc = getActiveDocument();
    document.getElementById("document-info").textContent = `${doc.title} · ${doc.width} × ${doc.height}`;
    return doc;
  }
  async function run(id, callback) {
      if (busy) return;
      busy = true; ui.busy(true);
      try { await callback(); }
      catch (error) { log.error(id, error); ui.status(error.message || String(error), true); }
      finally { busy = false; ui.busy(false); }
  }
  function bind(id, callback) {
    document.getElementById(id).addEventListener("click", () => run(id, callback));
  }
  function dirty() {
    analysisDirty = true;
    document.getElementById("analysis-info").textContent = "人脸输入已改变，请重新分析；已有结果需先恢复。";
  }
  for (const id of ["face-x", "face-y", "face-width", "face-height", "landmarks"]) {
    document.getElementById(id).addEventListener("input", dirty);
    document.getElementById(id).addEventListener("change", dirty);
  }
  async function openLocator() {
    documentInfo();
    const image = await controller.thumbnail();
    const manual = await locator.open(image, ui.locatorManual(image));
    if (!manual) { ui.status("已取消图片定位，原有输入保留。"); return; }
    const doc = documentInfo();
    if (doc.id !== image.id || doc.width !== image.width || doc.height !== image.height ||
        doc.activeLayers.length !== 1 || doc.activeLayers[0].id !== image.sourceID) throw new Error("文档或源图层已改变，本次定位未写入。请重新定位。");
    ui.setManual(manual, image); dirty();
    ui.status("八点手动定位已写入。点击分析人脸，再预览；照片像素尚未修改。");
    log.info("图片点选定位完成", { documentID: image.id, sourceID: image.sourceID, automaticDetection: false });
  }
  bind("locator-button", openLocator);
  bind("selection-button", async () => {
    const doc = documentInfo();
    const bounds = doc.selection.bounds;
    if (!bounds) throw new Error("请先用 Photoshop 矩形选框框住人脸。");
    ui.setBounds(bounds, describeDocument(doc)); dirty();
    ui.status("已读取选区外接框。请确认范围，再点击分析人脸。");
  });
  bind("analyze-button", async () => {
    const doc = documentInfo();
    ui.assertDocument(doc.id);
    ui.assertSource(doc.activeLayers.length === 1 ? doc.activeLayers[0].id : null);
    const face = await controller.analyze(ui.manual());
    analysisDirty = false;
    document.getElementById("analysis-info").textContent = `手动定位已验证 · 脸框 ${Math.round(face.metrics.faceWidth)} × ${Math.round(face.metrics.faceHeight)} · ${face.provenance.landmarksProvided ? "已提供关键点" : "无关键点，当前仅使用人脸框"}`;
    ui.status("手动定位已验证。可预览局部比例调整；缺少关键点的项目会跳过。");
  });
  const captures = [
    ["capture-left-eye", "leftEye", 0], ["capture-right-eye", "rightEye", 0],
    ["capture-nose", "nose", 0], ["capture-mouth", "mouth", 0],
    ["capture-left-cheek", "faceContour", 0], ["capture-right-cheek", "faceContour", 1],
    ["capture-left-jaw", "jaw", 0], ["capture-right-jaw", "jaw", 1]
  ];
  for (const [id, key, slot] of captures) bind(id, async () => {
    const doc = documentInfo();
    ui.capture(key, slot, doc.selection.bounds, describeDocument(doc)); dirty();
    ui.status(`已记录${document.getElementById(id).textContent}。记录其余点后点击分析人脸。`);
  });
  bind("clear-landmarks", async () => {
    const doc = documentInfo(); ui.clearLandmarks(doc.id); dirty();
    ui.status("关键点已清空。请确认当前照片的人脸范围，重新记录并分析。");
  });
  async function process(preview) {
    documentInfo();
    if (analysisDirty) throw new Error("人脸输入已改变，请恢复已有结果并重新分析。");
    ui.status("正在从原始图层生成几何、肤质和色调结果……");
    const pipeline = await controller.process(ui.parameters(), preview);
    ui.status(`${preview ? "预览" : "应用"}完成。${pipeline.active ? "切换 Portrait Correction 组的可见性可比较前后。" : "没有产生有效像素调整，复制结果与源像素一致。"}${pipeline.warnings.length ? ` 提示：${pipeline.warnings.join("；")}` : ""}`);
  }
  bind("preview-button", () => process(true));
  bind("apply-button", () => process(false));
  bind("reset-button", async () => {
    documentInfo();
    const removed = await controller.reset();
    ui.status(removed ? "已删除本次处理组，原始图层保留；可用 Photoshop 撤销恢复结果。" : "当前没有本会话可恢复的处理组。");
  });
  bind("preset-button", async () => { ui.preset(); ui.status("已载入保守起始参数，点击预览更新结果。"); });
  try { documentInfo(); } catch (_) { /* Opening the panel without a document is valid. */ }
  entrypoints.setup({
    commands: { portraitLocator: () => run("locator-button", openLocator) },
    panels: {
      portraitPerspective: {
        show() {
          try { documentInfo(); } catch (_) { /* No document is valid. */ }
          log.info("Portrait Perspective 面板已显示");
        }
      }
    }
  });
  log.info("v0.4 面板就绪", { analyzer: "manual-image-or-selection", automaticDetection: false, geometry: "landmark-local-v2" });
}
// Script is at the end of body: DOM is available without browser-only loaders.
try { initialize(); }
catch (error) {
  log.error("面板初始化失败", error);
  const status = document.getElementById("status");
  if (status) { status.textContent = `初始化失败：${error.message}`; status.className = "error"; }
}
