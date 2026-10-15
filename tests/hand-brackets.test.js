// Run: node tests/hand-brackets.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const calls = [];
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve("../marks.js"), "utf8"), ctx);
const marks = ctx.window.SkybridgeMarks;
const source = fs.readFileSync(require.resolve("../mathcanvas.js"), "utf8");
vm.runInContext(source.slice(source.indexOf("  function seeded("), source.indexOf("  // colors:")), ctx);
ctx.window.SkybridgeInk = { fill: (canvas, stroke) => { calls.push(stroke); return true; } };
const run = (name, fn) => { fn(); console.log("ok -", name); };
run("auto matrix brackets retain their existing dimensions", () => {
  const made = marks.brackets([20, 30, 120, 130]);
  assert.ok(Math.abs(made.gap - 14) < 1e-9);
  assert.equal(made.strokes.length, 2);
  assert.deepEqual(Array.from(made.strokes[0].points[0]).slice(0, 2), [19, 22]);
  assert.deepEqual(Array.from(made.strokes[1].points[0]).slice(0, 2), [121, 22]);
});
run("handwritten square brackets use the shared pen geometry, stay in their slots, and honour thickness", () => {
  for (const h of [40, 90, 200]) for (const side of ["L", "R"]) {
    const op = { kind: "square", side, x: 10, y: 20, w: 14, h, em: 28 };
    ctx.handBracket({}, op, 0);
    const thin = calls.at(-1);
    assert.equal(thin.clean, true); assert.equal(thin.sim, false); assert.equal(thin.done, true);
    for (const [x, y] of thin.points) {
      assert.ok(x >= op.x && x <= op.x + op.w, `x ${x} outside bracket slot`);
      assert.ok(y >= op.y && y <= op.y + op.h, `y ${y} outside bracket slot`);
    }
    const [start, end] = [thin.points[0], thin.points.at(-1)];
    assert.equal(start[0], end[0]); assert.ok(start[1] < end[1]);
    ctx.handBracket({}, op, 3); assert.ok(calls.at(-1).width > thin.width);
  }
});
run("missing pen renderer falls back to the same shared bracket path", () => {
  delete ctx.window.SkybridgeInk;
  const drawn = [];
  const canvas = { beginPath() {}, moveTo: (x, y) => drawn.push([x, y]), lineTo: (x, y) => drawn.push([x, y]), stroke() {} };
  ctx.handBracket(canvas, { kind: "square", side: "L", x: 10, y: 20, w: 14, h: 90, em: 28 });
  assert.equal(drawn.length, 19);
  assert.ok(drawn.every(([x, y]) => x >= 10 && x <= 24 && y >= 20 && y <= 110));
});
console.log("all handwritten bracket tests passed");
