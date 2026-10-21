// Run: node tests/nibs.test.js
// Pen types: each nib draws something, an unknown or missing nib is the ordinary pen, and nothing throws.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const root = "../../experimental-html-ui/";
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
class FakePath { constructor() { this.n = 0; } moveTo() { this.n += 1; } lineTo() { this.n += 1; } quadraticCurveTo() { this.n += 1; } closePath() {} }
ctx.Path2D = FakePath;
ctx.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, drawImage() {}, set fillStyle(v) {}, set globalCompositeOperation(v) {} }) }) };
vm.createContext(ctx);
const load = (file) => vm.runInContext(fs.readFileSync(require.resolve(root + file), "utf8"), ctx);
load("vendor/perfect-freehand.js");
if (!ctx.window.PerfectFreehand && ctx.PerfectFreehand) ctx.window.PerfectFreehand = ctx.PerfectFreehand;
load("inkstroke.js");
const Ink = ctx.window.SkybridgeInk;
assert.ok(Ink && Ink.NIBS, "SkybridgeInk.NIBS is exposed");
const target = () => { const t = { fills: 0, fillStyle: "#123456", globalAlpha: 1, fill() { t.fills += 1; }, createPattern: () => "pattern", beginPath() {}, moveTo() {}, quadraticCurveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fillRect() {} }; return t; };
const points = Array.from({ length: 30 }, (_, i) => [10 + i * 4, 40 + Math.sin(i / 4) * 12, 0.3 + 0.5 * Math.sin((i / 29) * Math.PI)]);
const run = (name, fn) => { fn(); console.log("ok -", name); };
run("every nib fills a finished and a live stroke", () => {
  for (const nib of [undefined, ...Object.keys(Ink.NIBS), "no-such-nib"]) {
    for (const done of [true, false]) {
      const t = target();
      assert.equal(Ink.fill(t, { points, width: 3, sim: false, done, nib }), true, `${nib} done=${done}`);
      assert.ok(t.fills >= 1, `${nib} drew nothing`);
    }
    const t = target();
    assert.equal(Ink.fill(t, { points, width: 3, sim: false, done: true, nib }, 2), true, `${nib} at scale 2`);
    assert.equal(Ink.fill(target(), { points: [[5, 5]], width: 3, sim: true, done: true, nib }), true, `${nib} single dot`);
  }
});
run("the pencil is filled with a grain pattern, the others with the plain colour", () => {
  const pencil = target();
  Ink.fill(pencil, { points, width: 3, sim: false, done: true, nib: "pencil" });
  assert.equal(pencil.fillStyle, "pattern");
  const fountain = target();
  Ink.fill(fountain, { points, width: 3, sim: false, done: true, nib: "fountain" });
  assert.equal(fountain.fillStyle, "#123456");
});
run("a stroke with no nib is cached the same way as before, and a changed nib redraws", () => {
  const a = { points, width: 3, sim: false, done: true };
  const t = target();
  Ink.fill(t, a);
  a.nib = "brush";
  Ink.fill(t, a);
  assert.equal(t.fills, 2);
});
