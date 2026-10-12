"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FaceAnalyzer, ManualFaceAdapter } = require("../src/face/FaceAnalyzer.js");
const { createPipeline } = require("../src/processing/pipeline.js");
const { maskWeight } = require("../src/processing/faceMask.js");
const { inverseMap } = require("../src/processing/geometry.js");
const { renderSkin } = require("../src/processing/skin.js");
const { renderTone } = require("../src/processing/tone.js");
const { luma } = require("../src/processing/color.js");
const landmarksNormalized = {
  leftEye: [{ x: .35, y: .35 }], rightEye: [{ x: .65, y: .35 }], nose: [{ x: .5, y: .55 }],
  mouth: [{ x: .5, y: .70 }], faceContour: [{ x: .25, y: .60 }, { x: .75, y: .60 }],
  jaw: [{ x: .30, y: .77 }, { x: .70, y: .77 }]
};
async function setup(scale = 1, parameters = {}) {
  const width = 320 * scale, height = 400 * scale;
  const face = await new FaceAnalyzer(new ManualFaceAdapter()).analyze({ image: { width, height },
    manual: { boundsPercent: { x: 20, y: 10, width: 60, height: 80 }, landmarksNormalized } });
  const pipeline = createPipeline(face, { strength: 100, faceWidth: 0, cheek: 0, jaw: 0, nose: 0, eyes: 0,
    skin: 100, tone: 100, ...parameters });
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, detail = Math.round(22 * Math.sin(x / 12) + 3 * Math.sin(y * 2));
    const noise = ((x * 7 + y * 11) % 17) - 8;
    data[i] = 178 + detail + noise; data[i + 1] = 136 + detail - Math.round(noise * .2126 / .7152);
    data[i + 2] = 115 + detail; data[i + 3] = 255;
  }
  return { face, pipeline, pixels: { data, width, height, components: 4,
    origin: { x: 0, y: 0 }, colorProfile: "sRGB IEC61966-2.1" } };
}
test("cheek mask follows geometry, scales with face size and protects feature cores", async () => {
  const a = await setup(1, { faceWidth: -50, cheek: -50 }), b = await setup(3, { faceWidth: -50, cheek: -50 });
  const mask = a.pipeline.skin.mask;
  for (const [x, y] of [[0, 0], [112, 140], [208, 140], [160, 220], [160, 280]]) assert.equal(maskWeight(x, y, mask), 0);
  assert(maskWeight(116, 231, mask) > .5);
  for (let y = 50; y < 350; y += 11) for (let x = 70; x < 250; x += 7) {
    assert(Math.abs(maskWeight(x, y, mask) - maskWeight(x * 3, y * 3, b.pipeline.skin.mask)) < 1e-12);
  }
  const neutral = await setup(), p = inverseMap(120, 230, a.pipeline.geometry);
  assert.equal(maskWeight(120, 230, mask), maskWeight(p.x, p.y, neutral.pipeline.skin.mask));
});
test("skin reduces chroma irregularity while retaining luma detail, source, alpha and mask exterior", async () => {
  const { pixels, pipeline } = await setup();
  const before = new Uint8Array(pixels.data), result = await renderSkin(pixels, pipeline.skin);
  assert(result.applied && result.changedPixels > 100);
  let beforeError = 0, afterError = 0, count = 0;
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    const i = (y * pixels.width + x) * 4, m = maskWeight(x + .5, y + .5, pipeline.skin.mask);
    assert.equal(result.data[i + 3], before[i + 3]);
    if (!m) assert.deepEqual(result.data.subarray(i, i + 4), before.subarray(i, i + 4));
    // Includes high-frequency luminance texture; byte rounding permits <= .5.
    assert(Math.abs(luma(...result.data.subarray(i, i + 3)) - luma(...before.subarray(i, i + 3))) <= .501);
    if (m > .5) {
      beforeError += (before[i] - before[i + 2] - 63) ** 2;
      afterError += (result.data[i] - result.data[i + 2] - 63) ** 2; count++;
    }
  }
  assert(count > 100 && afterError < beforeError * .8);
  assert.deepEqual(pixels.data, before);
});
test("tone balances sampled cheek shadows/highlights and retains color differences", async () => {
  const { pixels, pipeline } = await setup();
  const result = await renderTone(pixels, pipeline.tone), s = result.stats;
  assert(result.applied && result.changedPixels > 100);
  let lifts = 0, lowers = 0;
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    const i = (y * pixels.width + x) * 4;
    const dy = result.data[i] - pixels.data[i];
    assert.equal(result.data[i + 1] - pixels.data[i + 1], dy);
    assert.equal(result.data[i + 2] - pixels.data[i + 2], dy);
    assert.equal(result.data[i + 3], 255);
    if (!maskWeight(x + .5, y + .5, pipeline.tone.mask)) assert.equal(dy, 0);
    if (dy > 0) { lifts++; assert(luma(...pixels.data.subarray(i, i + 3)) / 255 < s.median); }
    if (dy < 0) { lowers++; assert(luma(...pixels.data.subarray(i, i + 3)) / 255 > s.median); }
  }
  assert(lifts > 50 && lowers > 50);
});
test("flat dark and bright skin has no whitening target; zero strength is byte-identical", async () => {
  for (const base of [45, 180]) {
    const { pixels, pipeline } = await setup();
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([base + 20, base, base - 10, 255], i);
    const output = await renderTone(pixels, pipeline.tone);
    assert.equal(output.applied, false); assert.deepEqual(output.data, pixels.data);
  }
  const { pixels, pipeline } = await setup(1, { strength: 0 });
  assert.deepEqual((await renderSkin(pixels, pipeline.skin)).data, pixels.data);
  assert.deepEqual((await renderTone(pixels, pipeline.tone)).data, pixels.data);
});
test("missing landmarks, insufficient samples and unknown/non-sRGB profiles skip explicitly", async () => {
  const { pixels, pipeline, face } = await setup();
  for (const colorProfile of ["", "Adobe RGB (1998)", "Display P3"]) {
    const output = await renderSkin({ ...pixels, colorProfile }, pipeline.skin);
    assert.equal(output.applied, false); assert.match(output.reason, /sRGB/); assert.equal(output.data, pixels.data);
  }
  face.landmarks.faceContour = [];
  const missing = createPipeline(face, { skin: 40, tone: 50 });
  assert.equal(missing.skin.available, false); assert.match((await renderSkin(pixels, missing.skin)).reason, /关键|双眼/);
  pixels.data.fill(0);
  assert.match((await renderTone(pixels, pipeline.tone)).reason, /采样不足/);
});
test("color processing cancellation propagates before any source mutation", async () => {
  const { pixels, pipeline } = await setup(); const saved = new Uint8Array(pixels.data);
  for (const [render, plan] of [[renderSkin, pipeline.skin], [renderTone, pipeline.tone]]) {
    await assert.rejects(render(pixels, plan, async fraction => { if (fraction > .2) throw new Error("cancelled"); }), /cancelled/);
    assert.deepEqual(pixels.data, saved);
  }
});
