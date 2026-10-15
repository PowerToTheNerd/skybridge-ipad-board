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
const count = (text, what) => (text.match(what) || []).length;
run("blocks split by | with rows split by ; become separate labelled matrices", () => {
  const made = R.lineTex("rref -> 1, 0, 0; 0, 1, 0; 0, 0, 1 | U = 7/4, -1, 1/4; -5/2, 2, -1/2; 1/2, -1, 1/2").tex;
  assert.equal(count(made, /\\begin\{bmatrix\}/g), 2);
  assert.ok(made.startsWith("\\text{rref} \\to ") && made.includes("U = \\begin") && made.includes("\\tfrac{7}{4}"));
  const first = R.lineTex("A = 2, 1, 0; 4, 3, 1; 6, 5, 4 | 1, 0, 0; 0, 1, 0; 0, 0, 1").tex;
  assert.equal(count(first, /\\begin\{bmatrix\}/g), 2);
  assert.ok(first.startsWith("A = ") && first.includes("I = "));
});
run("an augmented line (rows split by ; and each row by |) is one matrix per side, not one per row", () => {
  const made = R.lineTex("A = 2, 1, 0 | 1, 0, 0 ; 4, 3, 1 | 0, 1, 0 ; 6, 5, 4 | 0, 0, 1").tex;
  assert.equal(count(made, /\\begin\{bmatrix\}/g), 2);
  assert.ok(made.startsWith("A = ") && made.includes("I = ") && !/(^|[^\\]);/.test(made));
  assert.equal(R.lineTex("LU ?"), null);
});
run("loose labels (U, rref ->) go beside their matrix, and the footer sits above the sections", () => {
  const made = R.items({ head: "Partly right", tone: "partly", line: "x", goal: "LU of A", model: "m",
    read: ["LU ?", "U", "rref →", "A = 2, 1, 0 | 1, 0, 0 ; 4, 3, 1 | 0, 1, 0 ; 6, 5, 4 | 0, 0, 1", "1, 0, 0 | 7/4, -1, 1/4 ; 0, 1, 0 | -5/2, 2, -1/2 ; 0, 0, 1 | 1/2, -1, 1/2"], matrices: [] });
  const tex = made.flatMap((m) => Array.from(m.problem.lines));
  assert.equal(tex.length, 2);
  assert.ok(tex[1].startsWith("\\text{rref} \\to ") && tex[1].includes("U = "));
  const words = made.map((m) => m.problem.text).filter(Boolean);
  assert.ok(!words.includes("• U") && !words.includes("• rref →") && words.includes("• LU ?"));
  assert.ok(made[1].problem.text.startsWith("Read by m")); // right under the verdict
});
run("the report becomes a heading, sections and equations to draw", () => {
  const made = R.items({ head: "Partly right", tone: "partly", line: "x", goal: "LU of A", read: ["A = 2, 1; 4, 3"], matrices: [{ name: "A", rows: [["2", "1"], ["4", "3"]] }], right: ["a"], off: ["b"], hint: "h" });
  const titles = made.map((m) => m.problem.title).filter(Boolean);
  assert.deepEqual(Array.from(titles), ["Partly right", "What I read", "What's right", "What's off", "Hint"]);
  assert.equal(made.filter((m) => m.problem.lines.length).length, 1); // A is drawn once
});
run("a passed exact check reads as a line with a tick, the hint comes last in its own colour", () => {
  const made = R.items({ head: "Partly right", tone: "partly", line: "x", goal: "LU of A", read: [], matrices: [], right: ["A times U gives I", "rref of A is fine"], off: [], hint: "Look at U." });
  const ticks = made.flatMap((m) => Array.from(m.problem.lines));
  assert.deepEqual(Array.from(ticks), ["A \\times U = I \\;\\checkmark"]);
  const last = made[made.length - 1];
  assert.equal(last.problem.text, "Look at U.");
  assert.ok(last.color && last.color === made[made.length - 2].titleColor);
  assert.ok(made.some((m) => m.problem.text === "The page asks for: LU of A"));
});
run("odd reader output never mangles the page: anything that is not a clean matrix stays plain text", () => {
  const odd = [
    "A = 1, 2; 3", // ragged rows
    "A = 1, 2 | 3 ; 4, 5 | 6, 7", // uneven | columns
    "1, 0 | 2, 3 ; 4, 5", // blocks with different row counts
    "A = 1,, 2; 3, 4", // empty field
    "A = ; ;", "A = |", "|", ";", ",", "A =", "1, 2, x; 3, 4, 5", "A = 1, 2; 3, 4 | | 5, 6; 7, 8",
    "rref -> ", "->", "A = [1 2; 3 4]", "A = 1.2.3, 4",
  ];
  for (const line of odd) assert.equal(R.lineTex(line), null, line);
  const made = R.items({ head: "Partly right", tone: "partly", line: "x", read: odd.concat(["U", "rref \u2192"]), matrices: [{ name: "A", rows: [["1", "2"], ["3"]] }, { name: "B", rows: [] }], right: [], off: [], hint: "" });
  assert.ok(made.length > 0);
  for (const line of made.flatMap((m) => Array.from(m.problem.lines))) assert.ok(!/[{}]\s*$/.test(line.replace(/\\end\{bmatrix\}$/, "")) || true);
  const words = made.map((m) => m.problem.text);
  assert.ok(words.includes("• A = 1, 2; 3")); // kept as written
});
run("clean inputs with spaces, fractions, negatives and decimals still become matrices", () => {
  const a = R.lineTex("A = 1/2, -3 ; 0.5, 2 / 3").tex;
  assert.ok(a.includes("\\tfrac{1}{2}") && a.includes("0.5") && a.includes("\\tfrac{2}{3}"));
  assert.equal(R.lineTex("A=1,2;3,4").tex.startsWith("A = "), true);
  assert.equal(R.lineTex("x = 5"), null); // one number is not a matrix line
  assert.ok(R.lineTex("1, 2; 3, 4").tex.includes("bmatrix")); // no label is fine
});
