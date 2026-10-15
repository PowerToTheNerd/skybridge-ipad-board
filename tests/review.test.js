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
run("a line of matrix literals becomes typeset maths, not raw numbers", () => {
  const tex = R.lineTex("rref -> 1, 0; 0, 1 | U = 7/4, -1; 1/2, 3");
  assert.ok(tex.includes("\\to") && tex.includes("\\tfrac{7}{4}"));
  assert.equal((tex.match(/\\begin\{bmatrix\}/g) || []).length, 2);
  assert.equal(R.lineTex("LU ?"), null);
});
run("the report becomes a heading, sections and equations to draw", () => {
  const made = R.items({ head: "Partly right", tone: "partly", line: "x", goal: "LU of A", read: ["A = 2, 1; 4, 3"], matrices: [{ name: "A", rows: [["2", "1"], ["4", "3"]] }], right: ["a"], off: ["b"], hint: "h" });
  const titles = made.map((m) => m.problem.title).filter(Boolean);
  assert.deepEqual(Array.from(titles), ["Partly right", "The page asks for", "What I read", "What's right", "What's off", "Hint"]);
  assert.equal(made.filter((m) => m.problem.lines.length).length, 1); // A is drawn once
});
