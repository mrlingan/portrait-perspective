"use strict";
const { centroid } = require("../face/FaceMetrics.js");
const { inverseMap } = require("./geometry.js");
// Cheek support, NOT semantic skin segmentation. All locations derive from
// measured anchors. Evaluate through the same inverse geometry map.
function createFaceMask(face, geometry) {
  if (!geometry.supported.cheek) return { available: false, bounds: face.bounds, zones: [], protect: [], geometry,
    reason: "需有效的双眼、鼻尖、嘴中心和左右脸颊点；请完成定位后重新分析" };
  const w = face.metrics.faceWidth, h = face.metrics.faceHeight;
  const lm = face.landmarks, nose = centroid(lm.nose), mouth = centroid(lm.mouth);
  const contours = [...lm.faceContour].sort((a, b) => a.x - b.x);
  const pair = [contours[0], contours[contours.length - 1]];
  const zone = (p, rx, ry) => ({ x: p.x, y: p.y, rx, ry });
  return { available: true, bounds: face.bounds, geometry,
    zones: pair.map(p => zone({ x: nose.x + (p.x - nose.x) * .55,
      y: nose.y + (p.y - nose.y) * .55 }, w * .19, h * .19)),
    protect: [zone(centroid(lm.leftEye), w * .17, h * .14),
      zone(centroid(lm.rightEye), w * .17, h * .14),
      zone(nose, w * .13, h * .13), zone(mouth, w * .18, h * .10)] };
}
function maskWeight(x, y, mask) {
  if (!mask.available) return 0;
  const b = mask.bounds;
  if (x <= b.x || y <= b.y || x >= b.x + b.width || y >= b.y + b.height) return 0;
  const p = inverseMap(x, y, mask.geometry);
  let rest = 1;
  for (const z of mask.zones) {
    const r2 = ((p.x - z.x) / z.rx) ** 2 + ((p.y - z.y) / z.ry) ** 2;
    if (r2 < 1) rest *= 1 - (1 - r2) ** 2;
  }
  let value = 1 - rest;
  if (!value) return 0;
  for (const z of mask.protect) {
    const r2 = ((p.x - z.x) / z.rx) ** 2 + ((p.y - z.y) / z.ry) ** 2;
    if (r2 <= .36) return 0;
    if (r2 < 1) {
      const t = (r2 - .36) / .64;
      value *= t * t * (3 - 2 * t);
    }
  }
  return value;
}
module.exports = { createFaceMask, maskWeight };
