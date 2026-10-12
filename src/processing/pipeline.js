"use strict";
const { createGeometryPlan } = require("./geometry.js");
const { planSkin } = require("./skin.js");
const { planTone } = require("./tone.js");
const { createFaceMask } = require("./faceMask.js");
function createPipeline(face, parameters) {
  const geometry = createGeometryPlan(face, parameters);
  const p = geometry.parameters;
  const mask = createFaceMask(face, geometry);
  return {
    geometry, skin: planSkin(p, mask), tone: planTone(p, mask), parameters: p, active: geometry.active,
    warnings: [...geometry.warnings,
      ...["skin", "tone"].filter(k => p[k] !== 0 && p.strength && !mask.available).map(k => `${k}: 已跳过；${mask.reason}`)]
  };
}
module.exports = { createPipeline };
