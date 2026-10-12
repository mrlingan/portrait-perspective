"use strict";
const { SCHEMA, REFERENCE_STYLE } = require("../processing/parameters.js");
const { capturePoint } = require("../face/ManualInput.js");
function createControls() {
  const values = { ...REFERENCE_STYLE };
  let inputDocumentID = null;
  let inputLayerID = null;
  function readLandmarks() {
    const text = document.getElementById("landmarks").value.trim();
    try { return text ? JSON.parse(text) : {}; }
    catch (_) { throw new Error("关键点 JSON 格式不正确。"); }
  }
  const container = document.getElementById("sliders");
  for (const spec of SCHEMA) {
    const row = document.createElement("div");
    row.className = `slider${spec.implemented ? "" : " pending"}`;
    const heading = document.createElement("div");
    heading.className = "slider-heading";
    const label = document.createElement("label");
    label.setAttribute("for", `slider-${spec.key}`);
    label.textContent = spec.label + (spec.implemented ? "" : " · 待实现");
    const display = document.createElement("span");
    display.id = `value-${spec.key}`;
    display.textContent = String(spec.value);
    heading.appendChild(label); heading.appendChild(display);
    const slider = document.createElement("input");
    slider.type = "range"; slider.id = `slider-${spec.key}`;
    slider.min = String(spec.min); slider.max = String(spec.max); slider.step = "1"; slider.value = String(spec.value);
    const update = () => { values[spec.key] = Number(slider.value); display.textContent = slider.value; };
    slider.addEventListener("input", update); slider.addEventListener("change", update);
    const range = document.createElement("div");
    range.className = "range-labels";
    for (const text of [spec.min, spec.min < 0 ? 0 : "", spec.max]) {
      const span = document.createElement("span"); span.textContent = String(text); range.appendChild(span);
    }
    row.appendChild(heading); row.appendChild(slider); row.appendChild(range); container.appendChild(row);
  }
  return {
    parameters: () => ({ ...values }),
    assertDocument(id) {
      if (inputDocumentID !== null && inputDocumentID !== id) throw new Error("人脸输入属于另一文档。请重新读取人脸框，或清空关键点后重新填写范围。");
      inputDocumentID = id;
    },
    assertSource(id) {
      if (inputLayerID !== null && inputLayerID !== id) throw new Error("点选定位属于另一源图层，请选择定位时的原图层或重新定位。");
    },
    locatorManual(image) {
      if ((inputDocumentID !== null && inputDocumentID !== image.id) || (inputLayerID !== null && inputLayerID !== image.sourceID)) {
        return { boundsPercent: { x: 0, y: 0, width: 100, height: 100 }, landmarksNormalized: {} };
      }
      return this.manual();
    },
    setManual(manual, image) {
      for (const key of Object.keys(manual.boundsPercent)) document.getElementById(`face-${key}`).value = String(manual.boundsPercent[key]);
      document.getElementById("landmarks").value = JSON.stringify(manual.landmarksNormalized);
      inputDocumentID = image.id; inputLayerID = image.sourceID;
    },
    capture(key, slot, bounds, image) {
      this.assertDocument(image.id);
      const points = capturePoint(readLandmarks(), key, slot, bounds, image);
      document.getElementById("landmarks").value = JSON.stringify(points);
    },
    clearLandmarks(documentID) {
      document.getElementById("landmarks").value = "";
      inputLayerID = null;
      if (documentID !== undefined) inputDocumentID = documentID;
    },
    preset() {
      for (const spec of SCHEMA) {
        values[spec.key] = REFERENCE_STYLE[spec.key];
        document.getElementById(`slider-${spec.key}`).value = String(values[spec.key]);
        document.getElementById(`value-${spec.key}`).textContent = String(values[spec.key]);
      }
    },
    manual() {
      const read = id => {
        const value = document.getElementById(id).value.trim();
        if (!value) throw new Error("人脸范围不能留空。");
        return Number(value);
      };
      return { boundsPercent: { x: read("face-x"), y: read("face-y"), width: read("face-width"), height: read("face-height") }, landmarksNormalized: readLandmarks() };
    },
    setBounds(bounds, image) {
      if (inputDocumentID !== image.id) this.clearLandmarks();
      inputDocumentID = image.id;
      inputLayerID = null;
      const percentages = { x: bounds.left / image.width, y: bounds.top / image.height,
        width: (bounds.right - bounds.left) / image.width, height: (bounds.bottom - bounds.top) / image.height };
      for (const key of Object.keys(percentages)) document.getElementById(`face-${key}`).value = String(percentages[key] * 100);
    },
    busy(busy) {
      for (const el of document.getElementById("panel-content").querySelectorAll("button, input, textarea")) el.disabled = busy;
    },
    status(message, error = false) {
      const el = document.getElementById("status"); el.textContent = message; el.className = error ? "error" : "";
    }
  };
}
module.exports = { createControls };
