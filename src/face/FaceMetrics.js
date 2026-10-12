"use strict";

const LANDMARK_KEYS = ["leftEye", "rightEye", "nose", "mouth", "jaw", "faceContour", "chin"];
function centroid(points) {
  if (!points.length) return null;
  return points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
}
function validateFace(face, image) {
  const b = face && face.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0 ||
      b.x < 0 || b.y < 0 || b.x + b.width > image.width + 1e-6 || b.y + b.height > image.height + 1e-6) {
    throw new Error("人脸框必须完整位于画面内，且宽高大于 0。");
  }
  const landmarks = {};
  for (const key of LANDMARK_KEYS) {
    const points = (face.landmarks || {})[key] || [];
    if (!Array.isArray(points) || points.length > 1000) throw new Error(`${key} 必须为点数组（最多 1000 点）。`);
    landmarks[key] = points.map(p => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < b.x || p.y < b.y ||
          p.x > b.x + b.width || p.y > b.y + b.height) throw new Error(`${key} 关键点必须位于人脸框内。`);
      return { x: p.x, y: p.y };
    });
  }
  const left = centroid(landmarks.leftEye);
  const right = centroid(landmarks.rightEye);
  const eyeDistance = left && right ? Math.hypot(left.x - right.x, left.y - right.y) : null;
  if (eyeDistance !== null && eyeDistance < b.width * 0.05) throw new Error("双眼距离过小，请检查关键点。");
  return {
    bounds: { ...b }, landmarks,
    metrics: {
      faceWidth: b.width, faceHeight: b.height,
      eyeDistance, faceCenterX: b.x + b.width / 2, faceCenterY: b.y + b.height / 2
    },
    provenance: face.provenance || { adapter: "external" }
  };
}
module.exports = { validateFace, centroid, LANDMARK_KEYS };
