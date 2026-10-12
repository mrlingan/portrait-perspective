"use strict";
// Run ONLY in this plugin's UDT Console:
// require('./scripts/host-check.js').run().catch(console.error)
// Creates its own unsaved fixture document. Never writes an existing document.
const { app, core, imaging } = require("photoshop");
const { PortraitController } = require("../src/controller.js");
const { readSource } = require("../src/photoshop/warp.js");
const { readThumbnail } = require("../src/photoshop/thumbnail.js");
const { renderWarp } = require("../src/processing/resample.js");
const { renderSkin } = require("../src/processing/skin.js");
const { renderTone } = require("../src/processing/tone.js");
function check(ok, message) { if (!ok) throw new Error(`HOST CHECK: ${message}`); }
function equal(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
function sameRGB(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.width * a.height; i++) for (let c = 0; c < 3; c++) {
    if (a.data[i * a.components + c] !== b.data[i * b.components + c]) return false;
  }
  return true; // readSource already requires every alpha value to be 255.
}
function read(doc, layer) { return core.executeAsModal(() => readSource(doc, layer), { commandName: "Portrait Perspective · Inspect fixture" }); }
async function run() {
  const doc = await core.executeAsModal(() => app.createDocument({ name: "Portrait Perspective v0.4 Fixture",
    width: 320, height: 400, mode: "RGBColorMode", depth: 8, fill: "white", profile: "sRGB IEC61966-2.1" }),
  { commandName: "Portrait Perspective · Create fixture" });
  const source = doc.activeLayers[0];
  await core.executeAsModal(async () => {
    const initial = await readSource(doc, source);
    for (let y = 0; y < initial.height; y++) for (let x = 0; x < initial.width; x++) {
      const i = (y * initial.width + x) * initial.components;
      const detail = Math.round(22 * Math.sin(x / 12) + 3 * Math.sin(y * 2));
      const noise = ((x * 7 + y * 11) % 17) - 8;
      initial.data[i] = 178 + detail + noise;
      initial.data[i + 1] = 136 + detail - Math.round(noise * .2126 / .7152);
      initial.data[i + 2] = 115 + detail;
    }
    let image;
    try {
      image = await imaging.createImageDataFromBuffer(initial.data, { width: initial.width, height: initial.height,
        components: initial.components, colorSpace: "RGB", colorProfile: initial.colorProfile, chunky: true });
      await imaging.putPixels({ documentID: doc.id, layerID: source.id, imageData: image, replace: true, targetBounds: { left: 0, top: 0 } });
    } finally { if (image) image.dispose(); }
  }, { commandName: "Portrait Perspective · Fixture pixels" });
  const before = await read(doc, source), controller = new PortraitController();
  const thumbnail = await readThumbnail(doc, source);
  check(thumbnail.id === doc.id && thumbnail.sourceID === source.id && thumbnail.dataURL.startsWith("data:image/jpeg;base64,"), "locator must encode the correct source");
  check(equal((await read(doc, source)).data, before.data), "thumbnail changed source pixels");
  await controller.analyze({ boundsPercent: { x: 20, y: 10, width: 60, height: 80 }, landmarksNormalized: {
    leftEye: [{ x: .35, y: .35 }], rightEye: [{ x: .65, y: .35 }], nose: [{ x: .5, y: .55 }],
    mouth: [{ x: .5, y: .70 }], faceContour: [{ x: .25, y: .60 }, { x: .75, y: .60 }],
    jaw: [{ x: .30, y: .77 }, { x: .70, y: .77 }]
  } });
  const parameters = { strength: 100, faceWidth: 0, cheek: -50, jaw: -50, eyes: 20, nose: -30, skin: 100, tone: 100 };
  const plan = await controller.process(parameters, true);
  check(doc.layers.length === 2, "preview must add exactly one group");
  const group = doc.layers[0], firstID = group.id;
  check(group.layers.length === 3, "fixture must produce three real stages");
  const geometry = group.layers.find(l => l.name === "Geometry");
  const rendered = await read(doc, geometry);
  const expected = await renderWarp({ ...before, plan: plan.geometry });
  check(sameRGB(rendered, { ...before, data: expected }), "host pixels must match CPU geometry including outside-face pixels");
  check(!sameRGB(rendered, before), "local controls must actually change fixture pixels");
  const expectedSkin = await renderSkin({ ...before, data: expected }, plan.skin);
  const expectedTone = await renderTone({ ...before, data: expectedSkin.data }, plan.tone);
  check(plan.skin.active && plan.tone.active && expectedSkin.applied && expectedTone.applied, "color controls must change pixels");
  check(sameRGB(await read(doc, group.layers.find(l => l.name === "Skin")), { ...before, data: expectedSkin.data }), "Skin pixels must match CPU renderer");
  const finalPixels = await read(doc, group.layers[0]);
  check(group.layers[0].name === "Tone" && sameRGB(finalPixels, { ...before, data: expectedTone.data }), "Tone pixels/order must match CPU renderer");
  check(equal((await read(doc, source)).data, before.data), "source pixels changed");
  await controller.process(parameters, false);
  check(doc.layers.length === 2 && doc.layers[0].id !== firstID && doc.layers[0].name === "Portrait Correction", "apply must replace preview");
  check(equal((await read(doc, doc.layers[0].layers[0])).data, finalPixels.data), "repeated processing accumulated deformation");
  const appliedHistory = doc.activeHistoryState;
  await controller.reset();
  check(doc.layers.length === 1 && doc.layers[0].id === source.id, "reset must preserve only source");
  check(equal((await read(doc, source)).data, before.data), "reset changed original pixels");
  const resetHistory = doc.activeHistoryState;
  await core.executeAsModal(async () => { doc.activeHistoryState = appliedHistory; }, { commandName: "Fixture · Undo reset via history" });
  check(doc.layers.length === 2, "history must restore the removed correction group");
  await core.executeAsModal(async () => { doc.activeHistoryState = resetHistory; }, { commandName: "Fixture · Redo reset via history" });
  check(doc.layers.length === 1, "redo reset must remove the group again");
  const result = { documentID: doc.id, width: doc.width, height: doc.height,
    locatorThumbnail: "PASS", localControls: "PASS", skinToneStages: "PASS", imagingRoundTrip: "PASS", sourceUnchanged: "PASS", replacePreview: "PASS", reset: "PASS", historyRestore: "PASS" };
  console.log("PORTRAIT_HOST_CHECK_PASS", JSON.stringify(result));
  return result;
}
module.exports = { run };
