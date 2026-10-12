"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFace } = require("../src/face/FaceMetrics.js");
const { capturePoint, selectionPoint } = require("../src/face/ManualInput.js");
const { createGeometryPlan, inverseMap } = require("../src/processing/geometry.js");
const { renderWarp } = require("../src/processing/resample.js");
const ZERO = { strength: 100, faceWidth: 0, cheek: 0, jaw: 0, eyes: 0, nose: 0, skin: 0, tone: 0 };
function face(scale = 1, overrides = {}) {
  const points = { leftEye: [{ x: 35, y: 45 }], rightEye: [{ x: 65, y: 45 }],
    nose: [{ x: 50, y: 66 }], mouth: [{ x: 50, y: 85 }],
    faceContour: [{ x: 25, y: 72 }, { x: 75, y: 72 }], jaw: [{ x: 30, y: 92 }, { x: 70, y: 92 }], ...overrides };
  return validateFace({ bounds: { x: 20 * scale, y: 12 * scale, width: 60 * scale, height: 96 * scale },
    landmarks: Object.fromEntries(Object.entries(points).map(([key, ps]) => [key, ps.map(p => ({ x: p.x * scale, y: p.y * scale }))])) },
  { width: 100 * scale, height: 120 * scale });
}
test("selection capture uses normalized center, preserves other points and rejects invalid ordering/bounds", () => {
  const image = { width: 100, height: 120 };
  const box = { left: 30, top: 40, right: 40, bottom: 50 };
  assert.deepEqual(selectionPoint(box, image), { x: .35, y: .375 });
  const input = { mouth: [{ x: .5, y: .7 }] }, saved = JSON.stringify(input);
  const left = capturePoint(input, "faceContour", 0, box, image);
  const both = capturePoint(left, "faceContour", 1, { ...box, left: 60, right: 70 }, image);
  assert.equal(JSON.stringify(input), saved);
  assert.equal(both.faceContour.length, 2);
  assert.deepEqual(both.mouth, input.mouth);
  assert.throws(() => capturePoint({}, "jaw", 1, box, image), /先记录/);
  assert.throws(() => selectionPoint(null, image), /选框/);
  assert.throws(() => selectionPoint({ ...box, left: -1 }, image), /画布/);
});
test("each local control has independent, correctly signed effect and preserves feature centers", () => {
  const probes = { cheek: [75, 72], jaw: [70, 92], nose: [55, 66], eyes: [38, 45] };
  for (const key of Object.keys(probes)) {
    for (const value of [-30, 30]) {
      const plan = createGeometryPlan(face(), { ...ZERO, [key]: value });
      assert.equal(plan.supported[key], true);
      const [x, y] = probes[key], p = inverseMap(x, y, plan);
      assert.notEqual(p.x, x, key);
      assert.equal(Math.sign(p.x - x), -Math.sign(value));
      for (const [cx, cy] of [[35, 45], [65, 45], [50, 66], [50, 85]]) {
        assert.deepEqual(inverseMap(cx, cy, plan), { x: cx, y: cy }, `${key} moved feature center`);
      }
    }
  }
});
test("nose/eye rendering works when face-width is zero; vertical resampling is not skipped", async () => {
  const width = 100, height = 120, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3; data[i] = (x * 11) % 256; data[i + 1] = (y * 17) % 256; data[i + 2] = (x + y) % 256;
  }
  const saved = new Uint8Array(data);
  const plan = createGeometryPlan(face(), { ...ZERO, nose: -30, eyes: 30 });
  const output = await renderWarp({ data, width, height, components: 3, origin: { x: 0, y: 0 }, plan });
  assert.notDeepEqual(output, data);
  assert(output.some((v, i) => i % 3 === 1 && v !== data[i]), "vertical resampling must change the y-gradient");
  assert.deepEqual(data, saved);
  const zero = await renderWarp({ data, width, height, components: 3, origin: { x: 0, y: 0 },
    plan: createGeometryPlan(face(), { ...ZERO, strength: 0, nose: -30, cheek: -50, jaw: -50, eyes: 30 }) });
  assert.deepEqual(zero, data);
});
test("missing, misordered or tilted features skip unsupported fields explicitly", () => {
  for (const overrides of [{ mouth: [] }, { nose: [{ x: 50, y: 90 }] }, { rightEye: [{ x: 65, y: 60 }] }]) {
    const plan = createGeometryPlan(face(1, overrides), { ...ZERO, nose: -30, eyes: 30, cheek: -50, jaw: -50 });
    assert.equal(plan.active, false);
    assert.equal(plan.warnings.length, 4);
    assert.deepEqual(inverseMap(55, 66, plan), { x: 55, y: 66 });
  }
  const noJaw = createGeometryPlan(face(1, { jaw: [] }), { ...ZERO, jaw: -50, nose: -30 });
  assert.equal(noJaw.supported.jaw, false);
  assert.equal(noJaw.supported.nose, true);
});
test("all combined fields scale with resolution and keep mouth core and external pixels fixed", () => {
  const p = { ...ZERO, faceWidth: -50, cheek: -50, jaw: -50, nose: -30, eyes: 30 };
  const small = createGeometryPlan(face(), p), large = createGeometryPlan(face(7), p);
  for (let y = 0; y < 120; y += 2.3) for (let x = 0; x < 100; x += 1.7) {
    const a = inverseMap(x, y, small), b = inverseMap(x * 7, y * 7, large);
    assert(Math.abs(a.x - b.x / 7) < 1e-10 && Math.abs(a.y - b.y / 7) < 1e-10);
    if (x <= 20 || x >= 80 || y <= 12 || y >= 108) assert.deepEqual(a, { x, y });
  }
  for (const [x, y] of [[50, 85], [52, 85], [48, 86]]) assert.deepEqual(inverseMap(x, y, small), { x, y });
});
test("sampled Jacobians remain positive and samples stay inside the face for all extreme slider combinations", () => {
  const f = face(), e = .001;
  for (let bits = 0; bits < 32; bits++) {
    const p = { ...ZERO };
    ["faceWidth", "cheek", "jaw", "nose", "eyes"].forEach((k, i) => { p[k] = (bits & (1 << i) ? 1 : -1) * (i < 3 ? 50 : 30); });
    const plan = createGeometryPlan(f, p);
    for (let y = 12.1; y < 108; y += 1.5) for (let x = 20.1; x < 80; x += 1.5) {
      const a = inverseMap(x, y, plan), bx = inverseMap(x + e, y, plan), by = inverseMap(x, y + e, plan);
      const det = ((bx.x - a.x) * (by.y - a.y) - (bx.y - a.y) * (by.x - a.x)) / (e * e);
      assert(det > .5, `Jacobian ${det} at ${x},${y} bits=${bits}`);
      assert(a.x >= 20 && a.x <= 80 && a.y >= 12 && a.y <= 108);
    }
  }
});
