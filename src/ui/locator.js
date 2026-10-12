"use strict";
const { LocatorSession, STEPS, normalizedBounds, pointFromClient, project, fitViewport } = require("../face/LocatorSession.js");
function createLocator() {
  const dialog = document.getElementById("locator-dialog"), stage = document.getElementById("locator-stage");
  const photo = document.getElementById("locator-photo"), overlay = document.getElementById("locator-overlay");
  const prompt = document.getElementById("locator-prompt"), error = document.getElementById("locator-error");
  const done = document.getElementById("locator-done"), buttons = [];
  let active = null, ready = false, accepted = null;
  function clearOverlay() { while (overlay.firstChild) overlay.removeChild(overlay.firstChild); }
  function mark(p, label, size, className) {
    const v = project(p, active.state.view), el = document.createElement("div");
    el.className = className; el.textContent = label;
    el.style.left = `${v.x * size.width - 8}px`; el.style.top = `${v.y * size.height - 8}px`;
    overlay.appendChild(el);
  }
  function render() {
    if (!active) return;
    const s = active.state, view = s.view, size = fitViewport(active.image, view, 536, 380);
    stage.style.width = `${size.width}px`; stage.style.height = `${size.height}px`;
    photo.style.width = `${size.width / view.width}px`; photo.style.height = `${size.height / view.height}px`;
    photo.style.left = `${-view.x * size.width / view.width}px`; photo.style.top = `${-view.y * size.height / view.height}px`;
    clearOverlay();
    const b = normalizedBounds(s.manual.boundsPercent), p = project(b, view), frame = document.createElement("div");
    frame.className = "locator-frame"; frame.style.left = `${p.x * size.width}px`; frame.style.top = `${p.y * size.height}px`;
    frame.style.width = `${b.width / view.width * size.width}px`; frame.style.height = `${b.height / view.height * size.height}px`;
    overlay.appendChild(frame);
    for (let i = 2; i < STEPS.length; i++) {
      const step = STEPS[i], point = ((s.manual.landmarksNormalized || {})[step.key] || [])[step.slot];
      if (point) mark(point, String(i - 1), size, "locator-marker");
    }
    if (s.corner) mark(s.corner, "+", size, "locator-corner");
    for (let i = 0; i < buttons.length; i++) buttons[i].className = i === s.step ? "primary" : "";
    const count = STEPS.slice(2).filter((_, i) => active.has(i + 2)).length;
    prompt.textContent = !ready ? "正在读取定位预览……" : s.step === null ? "八点已齐，可选择任意位置按钮重记，或完成定位。" :
      `请在图片上点击：${STEPS[s.step].label}（关键点 ${count}/8）`;
    done.disabled = !ready || !active.complete();
    document.getElementById("locator-undo").disabled = !active.history.length;
  }
  function safe(action) {
    if (!active) return;
    try { action(); error.textContent = ""; render(); }
    catch (e) { error.textContent = e.message || String(e); }
  }
  const stepContainer = document.getElementById("locator-step-buttons");
  for (let i = 0; i < STEPS.length; i++) {
    const button = document.createElement("button");
    button.textContent = i < 2 ? STEPS[i].label : `${i - 1} ${STEPS[i].label}`;
    button.addEventListener("click", () => safe(() => active.select(i)));
    stepContainer.appendChild(button); buttons.push(button);
  }
  stage.addEventListener("click", event => safe(() => {
    if (!ready) throw new Error("请等待图片载入完成。");
    active.click(pointFromClient(event, stage.getBoundingClientRect(), active.state.view));
  }));
  photo.addEventListener("load", () => { if (active) { ready = true; render(); } });
  photo.addEventListener("error", () => {
    if (active) { ready = false; done.disabled = true; error.textContent = "预览图加载失败，请取消后重新打开。"; }
  });
  document.getElementById("locator-overview").addEventListener("click", () => safe(() => active.overview()));
  document.getElementById("locator-zoom").addEventListener("click", () => safe(() => active.zoom()));
  document.getElementById("locator-undo").addEventListener("click", () => safe(() => active.undo()));
  document.getElementById("locator-cancel").addEventListener("click", () => dialog.close("cancel"));
  done.addEventListener("click", () => safe(() => {
    if (!ready) throw new Error("图片尚未准备就绪。");
    accepted = active.result(); dialog.close("accept");
  }));
  return {
    async open(image, manual) {
      if (active) throw new Error("定位窗口已打开。");
      active = new LocatorSession(image, manual); ready = false; accepted = null;
      error.textContent = "";
      try {
        render(); photo.src = image.dataURL;
        const response = await dialog.uxpShowModal({ title: "Portrait Perspective · 手动图片定位", resize: "none",
          size: { width: 620, height: 740 } });
        return response === "accept" ? accepted : null;
      } finally {
        active = null; ready = false; accepted = null;
        photo.removeAttribute("src"); clearOverlay();
      }
    }
  };
}
module.exports = { createLocator };
