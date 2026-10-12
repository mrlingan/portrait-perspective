"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FaceAnalyzer, ManualFaceAdapter } = require("../src/face/FaceAnalyzer.js");
const { createGeometryPlan, inverseMap } = require("../src/processing/geometry.js");
const { createPipeline } = require("../src/processing/pipeline.js");
const { renderWarp } = require("../src/processing/resample.js");
const analyzer = new FaceAnalyzer(new ManualFaceAdapter());
const manual = { boundsPercent: { x: 20, y: 10, width: 60, height: 80 } };
const analyze = (scale = 1) => analyzer.analyze({ image: { width: 100 * scale, height: 120 * scale }, manual });

test("manual face returns empty missing landmarks, not fabricated eye metrics", async () => {
  const face = await analyze();
  assert.equal(face.metrics.eyeDistance, null);
  assert.deepEqual(face.landmarks.leftEye, []);
  assert.equal(face.provenance.automaticDetection, false);
  assert.equal(face.metrics.faceWidth, 60);
});
test("manual coordinates are validated and eye metrics use actual supplied points", async () => {
  await assert.rejects(analyzer.analyze({ image: { width: 100, height: 120 }, manual: { boundsPercent: { x: 80, y: 10, width: 50, height: 60 } } }));
  await assert.rejects(analyzer.analyze({ image: { width: 100, height: 120 }, manual: { ...manual, landmarksNormalized: { nose: [{ x: 1.2, y: 0.4 }] } } }));
  const face = await analyzer.analyze({ image: { width: 100, height: 120 }, manual: { ...manual,
    landmarksNormalized: { leftEye: [{ x: 0.35, y: 0.4 }], rightEye: [{ x: 0.65, y: 0.4 }] } } });
  assert.equal(face.metrics.eyeDistance, 30);
});
test("warp coordinates scale with resolution and are invariant in normalized space", async () => {
  const small = createGeometryPlan(await analyze(), { strength: 100, faceWidth: -50 });
  const large = createGeometryPlan(await analyze(10), { strength: 100, faceWidth: -50 });
  const a = inverseMap(65, 60, small), b = inverseMap(650, 600, large);
  assert(Math.abs(a.x - b.x / 10) < 1e-10);
  assert.equal(a.y, b.y / 10);
  assert(a.x > 65, "narrowing must sample outward on the right side");
});
test("identity at center, boundaries, outside ellipse, and zero strength", async () => {
  const face = await analyze();
  const plan = createGeometryPlan(face, { strength: 100, faceWidth: -50 });
  for (const [x, y] of [[50, 60], [20, 60], [80, 60], [50, 12], [0, 0], [90, 110]]) assert.deepEqual(inverseMap(x, y, plan), { x, y });
  const zero = createGeometryPlan(face, { strength: 0, faceWidth: -50 });
  assert.deepEqual(inverseMap(65, 60, zero), { x: 65, y: 60 });
});
test("both extreme slider directions produce no folds and no out-of-support samples", async () => {
  const face = await analyze();
  for (const faceWidth of [-50, 50]) {
    const plan = createGeometryPlan(face, { strength: 100, faceWidth });
    for (let y = 12; y <= 108; y += 3) {
      let previous = -Infinity;
      for (let x = 20; x <= 80; x += 0.1) {
        const mapped = inverseMap(x, y, plan);
        assert(mapped.x > previous);
        assert(mapped.x >= 20 - 1e-6 && mapped.x <= 80 + 1e-6);
        previous = mapped.x;
      }
    }
  }
});
test("render leaves source and outside-face pixels byte-identical; zero produces exact copy", async () => {
  const width = 100, height = 120, components = 3;
  const data = new Uint8Array(width * height * components);
  for (let i = 0; i < data.length; i++) data[i] = (i * 43 + Math.floor(i / 100)) % 256;
  const saved = new Uint8Array(data);
  const face = await analyze();
  const plan = createGeometryPlan(face, { strength: 100, faceWidth: -50 });
  const options = { data, width, height, components, origin: { x: 0, y: 0 }, plan };
  const output = await renderWarp(options);
  assert.deepEqual(data, saved);
  assert.notDeepEqual(output, data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + 0.5, dy = y + 0.5;
    if (inverseMap(dx, dy, plan).x === dx) {
      const i = (y * width + x) * components;
      assert.deepEqual(output.slice(i, i + 3), data.slice(i, i + 3));
    }
  }
  const zero = await renderWarp({ ...options, plan: createGeometryPlan(face, { strength: 0 }) });
  assert.deepEqual(zero, data);
});
test("non-zero layer origin uses document coordinates correctly", async () => {
  const face = await analyze();
  const plan = createGeometryPlan(face, { strength: 100, faceWidth: -50 });
  const width = 160, height = 180, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(y * width + x) * 3] = x;
  const output = await renderWarp({ data, width, height, components: 3, origin: { x: -30, y: -30 }, plan });
  assert(output[((60 + 30) * width + 65 + 30) * 3] > data[((60 + 30) * width + 65 + 30) * 3]);
  assert.deepEqual(output.slice(0, 300), data.slice(0, 300));
});
test("pipeline preserves all slider parameters and explicitly skips color stages without landmarks", async () => {
  const pipeline = createPipeline(await analyze(), { skin: 40, eyes: 10, tone: 20 });
  assert.equal(pipeline.parameters.eyes, 10);
  assert.equal(pipeline.skin.implemented, true);
  assert.equal(pipeline.skin.requested, 40);
  assert.equal(pipeline.tone.requested, 20);
  assert(pipeline.warnings.some(w => w.startsWith("eyes: 已跳过")));
  assert(pipeline.warnings.some(w => w.startsWith("skin:")));
  assert(pipeline.warnings.some(w => w.startsWith("tone:")));
});
test("cancellation propagates without mutating source", async () => {
  const data = new Uint8Array(100 * 120 * 3);
  await assert.rejects(renderWarp({ data, width: 100, height: 120, components: 3, origin: { x: 0, y: 0 },
    plan: createGeometryPlan(await analyze(), { strength: 100, faceWidth: -50 }), checkpoint: async () => { throw new Error("cancelled"); } }), /cancelled/);
  assert(data.every(v => v === 0));
});
