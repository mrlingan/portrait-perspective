"use strict";
// Development-only Node check. Not loaded by UXP and requires no npm packages.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifestVersion, 5);
assert.equal(manifest.host.app, "PS");
assert.equal(manifest.host.data.apiVersion, 2);
assert.equal(manifest.host.minVersion, "25.0.0");
assert(fs.existsSync(path.join(root, manifest.main)));
assert(manifest.entrypoints.some(e => e.type === "panel" && e.id === "portraitPerspective"));
assert(manifest.entrypoints.some(e => e.type === "command" && e.id === "portraitLocator"));
assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(directory, e.name)) : [path.join(directory, e.name)]);
}
const runtime = [path.join(root, "index.js"), ...walk(path.join(root, "src")).filter(f => f.endsWith(".js"))];
for (const file of runtime) {
  const code = fs.readFileSync(file, "utf8");
  new vm.Script(code, { filename: file });
  for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const target = match[1];
    if (target.startsWith(".")) assert(fs.existsSync(path.resolve(path.dirname(file), target)), `Missing module: ${file}: ${target}`);
    else assert(["photoshop", "uxp"].includes(target), `Node/browser module in UXP runtime: ${target}`);
  }
}
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), m => m[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate HTML IDs");
for (const file of runtime) {
  const code = fs.readFileSync(file, "utf8");
  for (const match of code.matchAll(/getElementById\(["']([^"']+)["']\)/g)) assert(ids.includes(match[1]), `Missing HTML ID: ${match[1]}`);
}
console.log(`PASS manifest, ${runtime.length} runtime JS syntax/module paths, ${ids.length} HTML IDs. Host loading still requires UDT.`);
