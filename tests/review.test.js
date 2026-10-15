// Run: node tests/review.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ctx = { window: {}, document: { documentElement: {}, getElementById: () => null } };
vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync(require.resolve("../review.js"), "utf8"), ctx); } catch (e) { console.error(e.message); }
const R = ctx.window.SkybridgeReview;
assert.ok(R, "SkybridgeReview is exposed");
const run = (name, fn) => { fn(); console.log("ok -", name); };
run("fractions become typeset fractions", () => {
  assert.equal(R.cellOf("-5/2"), "-\\tfrac{5}{2}");
  assert.equal(R.cellOf("3"), "3");
});
run("odd characters are dropped from a cell", () => {
  assert.ok(!/[{}\\$]/.test(R.cellOf("a}\\x$").replace(/\\tfrac/g, "")));
});
run("a matrix becomes a named bmatrix", () => {
  const tex = R.latexOf({ name: "L", rows: [["1", "0"], ["2", "1"]] });
  assert.ok(tex.startsWith("L = "));
  assert.ok(tex.includes("\\begin{bmatrix}") && tex.includes("\\end{bmatrix}"));
  assert.ok(tex.includes("2 & 1"));
});
