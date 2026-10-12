"use strict";
// Behavioral transaction tests against a small host simulator. These verify our
// controller, NOT Adobe API availability, rendering or UDT loading.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function harness() {
  let nextID = 10, selected = 1;
  const undo = [], redo = [], writes = [];
  const constants = { DocumentMode: { RGB: "RGB" }, BitsPerChannelType: { EIGHT: 8 },
    LayerKind: { NORMAL: "pixel", GROUP: "group" }, BlendMode: { NORMAL: "normal" } };
  const doc = { id: 7, title: "host-simulator", width: 128, height: 160, mode: "RGB", bitsPerChannel: 8,
    layers: [], activeHistoryState: { id: 1 } };
  const host = { failWrite: false, modal: false, thumbnailDisposals: 0, pixelRequests: [] };
  function modalRequired() { assert.equal(host.modal, true, "mutation outside executeAsModal"); }
  function find(id, entries = doc.layers) {
    for (const entry of entries) { if (entry.id === id) return entry; if (entry.layers) { const child = find(id, entry.layers); if (child) return child; } }
  }
  function makeLayer(id, name, kind, pixels, children = null) {
    return { id, name, kind, pixels, layers: children, parent: null, visible: true, opacity: 100, fillOpacity: 100,
      blendMode: "normal", isClippingMask: false, boundsNoEffects: { left: 0, top: 0, right: 128, bottom: 160 },
      async duplicate() {
        modalRequired(); const copy = makeLayer(nextID++, this.name, this.kind, new Uint8Array(this.pixels));
        const list = this.parent ? this.parent.layers : doc.layers;
        copy.parent = this.parent; list.splice(list.indexOf(this), 0, copy); return copy;
      },
      delete() {
        modalRequired(); const list = this.parent ? this.parent.layers : doc.layers;
        const index = list.indexOf(this);
        // Observed PS 27.0: deleting a group container may preserve its children.
        const children = this.kind === "group" ? this.layers : [];
        for (const child of children) child.parent = this.parent;
        list.splice(index, 1, ...children);
      }
    };
  }
  const original = new Uint8Array(128 * 160 * 3);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 3, detail = Math.round(22 * Math.sin(x / 7));
    const noise = (x * 7 + y * 11) % 17 - 8;
    original[i] = 178 + detail + noise;
    original[i + 1] = 136 + detail - Math.round(noise * .2126 / .7152);
    original[i + 2] = 115 + detail;
  }
  doc.layers = [makeLayer(1, "Original", "pixel", original)];
  Object.defineProperty(doc, "activeLayers", { get() { const layer = find(selected); return layer ? [layer] : []; } });
  doc.createLayerGroup = async options => {
    modalRequired(); const group = makeLayer(nextID++, options.name, "group", null, options.fromLayers);
    const index = doc.layers.indexOf(options.fromLayers[0]);
    for (const layer of options.fromLayers) { doc.layers.splice(doc.layers.indexOf(layer), 1); layer.parent = group; }
    doc.layers.splice(index, 0, group); return group;
  };
  function snapshot() {
    function serialize(layer) { return { id: layer.id, name: layer.name, kind: layer.kind, pixels: layer.pixels && Array.from(layer.pixels),
      children: layer.layers && layer.layers.map(serialize) }; }
    return { layers: doc.layers.map(serialize), selected };
  }
  function restore(saved) {
    function deserialize(s, parent = null) {
      const layer = makeLayer(s.id, s.name, s.kind, s.pixels && new Uint8Array(s.pixels));
      layer.parent = parent; layer.layers = s.children && s.children.map(child => deserialize(child, layer)); return layer;
    }
    doc.layers = saved.layers.map(s => deserialize(s)); selected = saved.selected;
  }
  host.undo = () => { assert(undo.length); redo.push(snapshot()); restore(undo.pop()); };
  host.redo = () => { assert(redo.length); undo.push(snapshot()); restore(redo.pop()); };
  const photoshop = {
    constants, app: { documents: [doc], activeDocument: doc },
    core: { async executeAsModal(callback) {
      assert.equal(host.modal, false); host.modal = true; let pending;
      try {
        return await callback({ isCancelled: false, reportProgress() {}, hostControl: {
          async suspendHistory() { pending = snapshot(); return { state: pending }; },
          async resumeHistory(suspension, commit) {
            modalRequired(); if (commit) { undo.push(suspension.state); redo.length = 0; }
            else restore(suspension.state); pending = null;
          }
        } });
      } catch (error) { if (pending) restore(pending); throw error; }
      finally { host.modal = false; }
    } },
    action: { async batchPlay(commands) {
      return commands.map(command => {
        if (command._obj === "get") return { hasUserMask: false, hasVectorMask: false };
        assert.equal(command._obj, "select"); modalRequired(); selected = command._target[0]._id; return {};
      });
    } },
    imaging: {
      async getPixels(options) {
        host.pixelRequests.push(options);
        const source = find(options.layerID);
        return { level: 0, sourceBounds: { left: 0, top: 0, right: 128, bottom: 160 },
          imageData: { width: 128, height: 160, components: 3, colorSpace: "RGB", componentSize: 8, colorProfile: "sRGB IEC61966-2.1",
            async getData() { return new Uint8Array(source.pixels); }, dispose() { host.thumbnailDisposals++; } } };
      },
      async encodeImageData(options) {
        modalRequired(); assert.equal(options.base64, true);
        if (host.failEncode) throw new Error("simulated encode failure");
        return "fixture-jpeg-base64";
      },
      async createImageDataFromBuffer(data, options) { return { ...options, data, dispose() {} }; },
      async putPixels(options) {
        modalRequired(); if (host.failWrite || host.failWriteAt === writes.length + 1) throw new Error("simulated write failure");
        writes.push(options.layerID); find(options.layerID).pixels = new Uint8Array(options.imageData.data);
      }
    }
  };
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (filename.endsWith(path.join("src", "log.js"))) return { info() {}, error() {} };
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = target => target === "photoshop" ? photoshop : load(path.resolve(path.dirname(filename), target));
    const wrapper = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, "utf8")}\n})`, { filename });
    wrapper(localRequire, module, module.exports); return module.exports;
  }
  const { PortraitController } = load(path.join(__dirname, "../src/controller.js"));
  const controller = new PortraitController();
  const analyze = (landmarksNormalized) => controller.analyze({ boundsPercent: { x: 20, y: 10, width: 60, height: 80 }, landmarksNormalized });
  return { controller, analyze, host, doc, writes, find, photoshop, original: new Uint8Array(original) };
}

test("no-document commands reject cleanly", async () => {
  const h = harness(); h.photoshop.app.documents = [];
  await assert.rejects(h.analyze(), /打开/);
  await assert.rejects(h.controller.process({}, true), /打开/);
  await assert.rejects(h.controller.thumbnail(), /打开/);
  await assert.rejects(h.controller.reset(), /打开/);
});
test("preview replacement is non-cumulative; reset retains original; undo reset recovers owned result", async () => {
  const h = harness(); await h.analyze();
  await h.controller.process({ strength: 100, faceWidth: -50 }, true);
  const firstPixels = new Uint8Array(h.doc.layers[0].layers[0].pixels);
  await h.controller.process({ strength: 100, faceWidth: -50 }, true);
  assert.equal(h.doc.layers.length, 2);
  assert.deepEqual(h.doc.layers[0].layers[0].pixels, firstPixels);
  assert.deepEqual(h.find(1).pixels, h.original);
  assert(h.writes.every(id => id !== 1));
  assert.equal(await h.controller.reset(), true);
  assert.equal(h.doc.layers.length, 1);
  assert.deepEqual(h.find(1).pixels, h.original);
  h.host.undo();
  assert.equal(await h.controller.reset(), true);
  assert.equal(h.doc.layers.length, 1);
});
test("Undo of replacement recognises older IDs and does not stack another correction", async () => {
  const h = harness(); await h.analyze();
  await h.controller.process({ strength: 100, faceWidth: -50 }, true);
  const firstID = h.doc.layers[0].id;
  await h.controller.process({ strength: 70, faceWidth: -20 }, true);
  h.host.undo(); assert.equal(h.doc.layers[0].id, firstID);
  await h.controller.process({ strength: 25, faceWidth: -10 }, false);
  assert.equal(h.doc.layers.length, 2);
  assert.equal(h.doc.layers[0].name, "Portrait Correction");
  assert.deepEqual(h.find(1).pixels, h.original);
});
test("write failure rolls back replacement and leaves session IDs usable", async () => {
  const h = harness(); await h.analyze(); await h.controller.process({}, true);
  const previousID = h.doc.layers[0].id;
  const previousPixels = new Uint8Array(h.doc.layers[0].layers[0].pixels);
  h.host.failWrite = true;
  await assert.rejects(h.controller.process({ strength: 100 }, false), /simulated write failure/);
  assert.equal(h.doc.layers[0].id, previousID);
  assert.deepEqual(h.doc.layers[0].layers[0].pixels, previousPixels);
  assert.equal(h.doc.layers.length, 2);
  h.host.failWrite = false;
  assert.equal(await h.controller.reset(), true);
});
test("reset refuses to delete a group containing added user content", async () => {
  const h = harness(); await h.analyze(); await h.controller.process({}, true);
  h.doc.layers[0].layers.push({ id: 999, name: "User content", kind: "pixel" });
  await assert.rejects(h.controller.reset(), /内容已被修改/);
  assert.equal(h.doc.layers[0].layers.length, 2);
});

const anchors = { leftEye: [{ x: .35, y: .35 }], rightEye: [{ x: .65, y: .35 }],
  nose: [{ x: .5, y: .55 }], mouth: [{ x: .5, y: .70 }],
  faceContour: [{ x: .25, y: .60 }, { x: .75, y: .60 }] };
test("color-only results create cumulative owned stages and replace/reset all copies", async () => {
  const h = harness(); await h.analyze(anchors);
  const p = { strength: 100, faceWidth: 0, cheek: 0, jaw: 0, nose: 0, eyes: 0, skin: 100, tone: 100 };
  const result = await h.controller.process(p, true);
  assert.equal(result.geometry.active, false); assert.equal(result.active, true);
  assert.equal(result.skin.active, true); assert.equal(result.tone.active, true);
  assert.deepEqual(h.doc.layers[0].layers.map(l => l.name), ["Tone", "Skin", "Geometry"]);
  const expected = new Uint8Array(h.doc.layers[0].layers[0].pixels);
  await h.controller.process(p, false);
  assert.equal(h.doc.layers.length, 2);
  assert.deepEqual(h.doc.layers[0].layers[0].pixels, expected);
  assert.deepEqual(h.find(1).pixels, h.original);
  await h.controller.reset(); assert.equal(h.doc.layers.length, 1);
  h.host.undo(); assert.equal(h.doc.layers[0].layers.length, 3);
  await h.controller.reset(); assert.equal(h.doc.layers.length, 1);
});
test("failure writing final color stage rolls back every partial layer and last result", async () => {
  const h = harness(); await h.analyze(anchors);
  const p = { strength: 100, skin: 100, tone: 100 };
  await h.controller.process(p, true);
  const beforeID = h.doc.layers[0].id, expected = new Uint8Array(h.doc.layers[0].layers[0].pixels);
  h.host.failWriteAt = h.writes.length + 3;
  await assert.rejects(h.controller.process(p, false), /simulated write failure/);
  assert.equal(h.doc.layers.length, 2); assert.equal(h.doc.layers[0].id, beforeID);
  assert.deepEqual(h.doc.layers[0].layers[0].pixels, expected);
  assert.deepEqual(h.find(1).pixels, h.original);
  await h.controller.reset(); assert.equal(h.doc.layers.length, 1);
});

test("locator thumbnail is read-only, bounded, color managed and releases the Imaging buffer", async () => {
  const h = harness(), thumbnail = await h.controller.thumbnail();
  assert.equal(thumbnail.id, h.doc.id); assert.equal(thumbnail.sourceID, 1);
  assert.equal(thumbnail.dataURL, "data:image/jpeg;base64,fixture-jpeg-base64");
  assert.equal(h.host.thumbnailDisposals, 1); assert.equal(h.writes.length, 0); assert.equal(h.doc.layers.length, 1);
  assert.deepEqual(h.find(1).pixels, h.original);
  const request = h.host.pixelRequests[0];
  assert.equal(request.colorProfile, "sRGB IEC61966-2.1");
  assert.deepEqual(request.sourceBounds, { left: 0, top: 0, right: 128, bottom: 160 });
  assert.deepEqual(request.targetSize, { height: 160 });
  h.host.failEncode = true; await assert.rejects(h.controller.thumbnail(), /encode failure/);
  assert.equal(h.host.thumbnailDisposals, 2); assert.equal(h.doc.layers.length, 1);
});
test("locator refuses to rebind inputs over an existing owned correction", async () => {
  const h = harness(); await h.analyze(); await h.controller.process({}, true);
  await assert.rejects(h.controller.thumbnail(), /先恢复/);
});
