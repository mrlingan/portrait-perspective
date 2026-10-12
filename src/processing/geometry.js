"use strict";
const { normalizeParameters } = require("./parameters.js");

const { centroid } = require("../face/FaceMetrics.js");

// Compact C1 kernels. Conservative 2D proportions, not a recovered camera model.
function weight(x, y, zone) {
  const r2 = ((x - zone.x) / zone.rx) ** 2 + ((y - zone.y) / zone.ry) ** 2;
  return r2 >= 1 ? 0 : (1 - r2) ** 2;
}
function protection(x, y, zones) {
  let result = 1;
  for (const z of zones) {
    const r2 = ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2;
    if (r2 <= 0.36) return 0;
    if (r2 < 1) {
      const t = (r2 - 0.36) / 0.64;
      result *= t * t * (3 - 2 * t);
    }
  }
  return result;
}
function createGeometryPlan(face, input) {
  const parameters = normalizeParameters(input);
  const s = parameters.strength / 100;
  const { faceWidth: w, faceHeight: h, faceCenterX: cx, faceCenterY: cy, eyeDistance } = face.metrics;
  const lm = face.landmarks;
  const eyes = [centroid(lm.leftEye), centroid(lm.rightEye)].filter(Boolean);
  const nose = centroid(lm.nose), mouth = centroid(lm.mouth);
  const zone = (p, rx, ry) => ({ x: p.x, y: p.y, rx, ry });
  const eyeProtection = eyes.map(p => zone(p, w * 0.15, h * 0.09));
  const mouthProtection = mouth ? [zone(mouth, w * 0.18, h * 0.10)] : [];
  const noseProtection = nose ? [zone(nose, w * 0.13, h * 0.13)] : [];
  const fields = [], warnings = [];
  const supported = { faceWidth: true, cheek: false, jaw: false, eyes: false, nose: false };
  // No fallback landmark positions are inferred from the rectangle.
  const hasFeatures = eyes.length === 2 && nose && mouth && eyeDistance > 0;
  const tilted = eyes.length === 2 && Math.abs(eyes[0].y - eyes[1].y) / eyeDistance > Math.sin(Math.PI / 12);
  const ordered = hasFeatures && nose.y > Math.max(...eyes.map(p => p.y)) && mouth.y > nose.y;
  const safeFeatures = hasFeatures && !tilted && ordered && eyeDistance >= w * 0.2 && eyeDistance <= w * 0.8;
  const addPair = (key, points) => {
    if (!safeFeatures || points.length < 2) return;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const pair = [sorted[0], sorted[sorted.length - 1]];
    if (pair[0].x > cx - w * 0.18 || pair[1].x < cx + w * 0.18 ||
        pair.some(p => p.y <= (key === "jaw" ? mouth.y : nose.y))) return;
    supported[key] = true;
    const amount = -(parameters[key] / 50) * 0.012 * w * s;
    for (let i = 0; i < 2; i++) fields.push({
      ...zone(pair[i], w * 0.23, h * 0.20), kind: "translate", dx: (i ? 1 : -1) * amount, dy: 0,
      protect: [...eyeProtection, ...noseProtection, ...mouthProtection]
    });
  };
  addPair("cheek", lm.faceContour);
  addPair("jaw", lm.jaw);
  if (safeFeatures) {
    supported.nose = true;
    fields.push({ ...zone(nose, Math.min(w * 0.22, eyeDistance * 0.43), Math.min(h * 0.23, eyeDistance * 0.60)),
      kind: "scale", kx: -(parameters.nose / 30) * 0.055 * s,
      ky: -(parameters.nose / 30) * 0.018 * s, protect: [...eyeProtection, ...mouthProtection] });
    supported.eyes = true;
    for (const eye of eyes) fields.push({ ...zone(eye, eyeDistance * 0.31, h * 0.065), kind: "scale",
      kx: -(parameters.eyes / 30) * 0.035 * s, ky: -(parameters.eyes / 30) * 0.035 * s,
      protect: [...noseProtection, ...mouthProtection] });
  }
  for (const key of ["cheek", "jaw", "eyes", "nose"]) {
    if (parameters[key] && !supported[key]) warnings.push(`${key}: 已跳过；需要双眼、鼻尖、嘴中心及有效轮廓点（正面、双眼倾斜不超过 15°）`);
  }
  if (!safeFeatures && parameters.faceWidth && s) warnings.push("脸宽演示缺少有效的完整五官定位；请检查关键点及姿态后预览。");
  const coefficient = -(parameters.faceWidth / 50) * 0.12 * s;
  return {
    type: "landmark-local-v2", bounds: face.bounds, metrics: face.metrics, coefficient, parameters,
    faceZone: { x: cx, y: cy, rx: w / 2, ry: h / 2 }, fields, supported, warnings,
    protect: [...eyeProtection, ...noseProtection, ...mouthProtection],
    active: coefficient !== 0 || fields.some(f => f.dx || f.dy || f.kx || f.ky)
  };
}
function inverseMap(x, y, plan) {
  if (!plan.active) return { x, y };
  const b = plan.bounds;
  if (x <= b.x || y <= b.y || x >= b.x + b.width || y >= b.y + b.height) return { x, y };
  const outer = weight(x, y, plan.faceZone);
  let dx = plan.coefficient * (x - plan.faceZone.x) * outer * protection(x, y, plan.protect), dy = 0;
  // Local kernels use rectangular edge feather, keeping contour anchors useful
  // near the ellipse edge. This is not semantic hair/background protection.
  const edge = Math.min(1, (x - b.x) / (b.width * 0.08), (b.x + b.width - x) / (b.width * 0.08),
    (y - b.y) / (b.height * 0.08), (b.y + b.height - y) / (b.height * 0.08));
  const feather = edge * edge * (3 - 2 * edge);
  for (const f of plan.fields) {
    const a = weight(x, y, f) * protection(x, y, f.protect) * feather;
    if (!a) continue;
    dx += a * (f.kind === "translate" ? f.dx : f.kx * (x - f.x));
    dy += a * (f.kind === "translate" ? f.dy : f.ky * (y - f.y));
  }
  return { x: x + dx, y: y + dy };
}
module.exports = { createGeometryPlan, inverseMap };
