"use strict";
const { validateFace, LANDMARK_KEYS } = require("./FaceMetrics.js");

/** Adapter contract: async analyze({image:{width,height}, manual, ...}) -> face.
 * Result coordinates: document pixels, origin top-left. No Photoshop dependency.
 * Future adapters own model inference and convert their coordinates here.
 */
class FaceAnalyzer {
  constructor(adapter) {
    if (!adapter || typeof adapter.analyze !== "function") throw new Error("FaceAnalyzer 需要 analyze adapter。");
    this.adapter = adapter;
  }
  async analyze(context) {
    if (!context || !context.image || ![context.image.width, context.image.height].every(v => Number.isFinite(v) && v > 0)) {
      throw new Error("FaceAnalyzer 需要有效的图像宽高。");
    }
    return validateFace(await this.adapter.analyze(context), context.image);
  }
}

class ManualFaceAdapter {
  async analyze({ image, manual }) {
    if (!manual) throw new Error("请先输入人脸范围。");
    const { x, y, width, height } = manual.boundsPercent;
    if (![x, y, width, height].every(Number.isFinite)) throw new Error("人脸范围必须是有效数字。");
    const input = manual.landmarksNormalized === undefined ? {} : manual.landmarksNormalized;
    if (Array.isArray(input) || typeof input !== "object" || input === null) throw new Error("关键点 JSON 必须是对象。");
    for (const key of Object.keys(input)) {
      if (!LANDMARK_KEYS.includes(key)) throw new Error(`未知关键点字段：${key}`);
    }
    const landmarks = {};
    for (const key of LANDMARK_KEYS) {
      const points = input[key] || [];
      if (!Array.isArray(points)) throw new Error(`${key} 必须是数组。`);
      landmarks[key] = points.map(p => {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
          throw new Error(`${key} 坐标必须为画面归一化值 0–1。`);
        }
        return { x: p.x * image.width, y: p.y * image.height };
      });
    }
    return {
      bounds: { x: x / 100 * image.width, y: y / 100 * image.height, width: width / 100 * image.width, height: height / 100 * image.height },
      landmarks,
      provenance: { adapter: "manual", automaticDetection: false, landmarksProvided: Object.values(landmarks).some(p => p.length > 0) }
    };
  }
}
module.exports = { FaceAnalyzer, ManualFaceAdapter };
