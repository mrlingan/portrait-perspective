"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { LocatorSession, pointFromClient, project, fitViewport } = require("../src/face/LocatorSession.js");
const { FaceAnalyzer, ManualFaceAdapter } = require("../src/face/FaceAnalyzer.js");
const blank = () => ({ boundsPercent: { x: 0, y: 0, width: 100, height: 100 }, landmarksNormalized: {} });
const image = { width: 768, height: 1024 };
const corners = [{ x: .2, y: .1 }, { x: .8, y: .9 }];
const points = [{ x: .35, y: .35 }, { x: .65, y: .35 }, { x: .5, y: .55 }, { x: .5, y: .70 },
  { x: .25, y: .60 }, { x: .75, y: .60 }, { x: .3, y: .77 }, { x: .7, y: .77 }];
function complete(model) { for (const p of [...corners, ...points]) model.click(p); return model; }
test("guided two corners and eight actual points produce valid normalized analyzer input", async () => {
  const initial = blank(), model = complete(new LocatorSession(image, initial));
  assert.equal(model.state.step, null); assert.equal(model.complete(), true);
  const result = model.result(), face = await new FaceAnalyzer(new ManualFaceAdapter()).analyze({ image, manual: result });
  assert(Math.abs(face.metrics.faceWidth - 768 * .6) < 1e-10);
  assert.equal(face.landmarks.nose[0].x, 768 * .5);
  assert.deepEqual(initial, blank(), "dialog draft must not mutate UI input");
  assert.throws(() => model.click(points[0]), /已完成/);
});
test("zoomed clicks and overlay projection round trip across sizes, offsets and fractional layout", () => {
  for (const view of [{ x: 0, y: 0, width: 1, height: 1 }, { x: .18, y: .22, width: .64, height: .63 }]) {
    for (const rect of [{ left: 43.5, top: -125.25, width: 243.75, height: 325 }, { left: 0, top: 0, width: 1000, height: 800 }]) {
      const p = pointFromClient({ clientX: rect.left + rect.width * .31, clientY: rect.top + rect.height * .72 }, rect, view);
      const display = project(p, view);
      assert(Math.abs(display.x - .31) < 1e-12 && Math.abs(display.y - .72) < 1e-12);
    }
  }
  assert.throws(() => pointFromClient({ clientX: -1, clientY: 5 }, { left: 0, top: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1, height: 1 }), /内部/);
  assert.throws(() => pointFromClient({ clientX: 0, clientY: 0 }, { left: 0, top: 0, width: 0, height: 10 }, {}), /布局/);
});
test("viewport fitting preserves document aspect under resolution changes and cropped zoom", () => {
  const model = complete(new LocatorSession(image, blank())); model.zoom();
  const v = model.state.view, small = fitViewport(image, v), large = fitViewport({ width: 7680, height: 10240 }, v);
  assert(Math.abs(small.width - large.width) < 1e-10 && Math.abs(small.height - large.height) < 1e-10);
  assert(small.width <= 536 && small.height <= 420);
  assert(Math.abs(small.width / small.height - image.width * v.width / (image.height * v.height)) < 1e-12);
});
test("redrawing clears staged landmarks; Undo restores every input and partial frame", () => {
  const model = complete(new LocatorSession(image, blank())), saved = model.result();
  model.select(0); model.click({ x: .1, y: .1 }); assert.equal(model.complete(), false);
  model.click({ x: .9, y: .95 }); assert.deepEqual(model.state.manual.landmarksNormalized, {});
  model.undo(); assert.equal(model.state.step, 1); assert.equal(model.complete(), false);
  model.undo(); assert.deepEqual(model.result(), saved);
  const exported = model.result(); exported.landmarksNormalized.nose[0].x = 0;
  assert.deepEqual(model.result(), saved);
});
test("invalid point/pair order does not alter draft, progress or undo history", () => {
  assert.throws(() => new LocatorSession(image, { boundsPercent: blank().boundsPercent, landmarksNormalized: [] }), /JSON/);
  assert.throws(() => new LocatorSession(image, { boundsPercent: blank().boundsPercent, landmarksNormalized: { nose: [{ x: NaN, y: .4 }] } }), /图片内/);
  const model = new LocatorSession(image, blank()); model.click(corners[0]);
  const before = JSON.stringify(model.state), n = model.history.length;
  assert.throws(() => model.click(corners[0]), /过小/); assert.equal(JSON.stringify(model.state), before); assert.equal(model.history.length, n);
  model.click(corners[1]); model.select(7);
  assert.throws(() => model.click(points[5]), /先记录/);
  model.select(2); assert.throws(() => model.click({ x: .99, y: .3 }), /脸框内/);
  assert.throws(() => model.click({ x: NaN, y: .3 }), /图片内/);
  assert.throws(() => model.result(), /八个关键点/);
});
test("re-recording any existing point preserves other anchors and Undo returns previous point", () => {
  const model = complete(new LocatorSession(image, blank())), original = model.result();
  model.select(4); model.click({ x: .51, y: .56 });
  assert.deepEqual(model.result().landmarksNormalized.mouth, original.landmarksNormalized.mouth);
  assert.deepEqual(model.result().landmarksNormalized.nose, [{ x: .51, y: .56 }]);
  model.undo(); assert.deepEqual(model.result(), original);
});
