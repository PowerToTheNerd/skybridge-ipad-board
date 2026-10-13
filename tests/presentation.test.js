// Run: node tests/presentation.test.js
const assert = require("assert");
const P = require("../presentation.js");
const run = (name, fn) => { fn(); console.log("ok -", name); };
const kinds = (r) => r.blocks.map((b) => b.k).join("");
const bm = (rows) => `\\begin{bmatrix} ${rows.map((r) => r.join(" & ")).join(" \\\\ ")} \\end{bmatrix}`;

run("3A: raw matrix in the sentence is shown once, as math, with the given matrix after it", () => {
  const saved = { title: "3A", text: "Find invertible U and V such that UAV = [I_r 0; 0 0], where r = rank(A).", lines: [`UAV = ${bm([["I_r", "0"], ["0", "0"]])}`, `A = ${bm([["1", "1", "-1"], ["-2", "-2", "4"]])}`] };
  const copy = JSON.stringify(saved);
  const r = P.present(saved);
  assert.deepStrictEqual(r.blocks, [
    { k: "p", src: "Find invertible U and V such that:" },
    { k: "d", src: `UAV = ${bm([["I_r", "0"], ["0", "0"]])}` },
    { k: "p", src: "where r = rank(A)." },
    { k: "p", src: "Given matrix:" },
    { k: "d", src: `A = ${bm([["1", "1", "-1"], ["-2", "-2", "4"]])}` },
  ]);
  assert.strictEqual(JSON.stringify(saved), copy, "the saved problem must not be modified");
  assert.ok(!r.blocks.some((b) => /\[I_r 0; 0 0\]/.test(b.src)), "no raw matrix notation left");
  assert.strictEqual(r.report.deduplicated.length, 1);
});

run("a raw matrix that is NOT also a line is converted and kept", () => {
  const r = P.present({ title: "x", text: "Let A = [1 2; 3 4] and find its rank.", lines: [] });
  assert.strictEqual(kinds(r), "pdp");
  assert.strictEqual(r.blocks[1].src, `A = ${bm([["1", "2"], ["3", "4"]])}`);
  assert.strictEqual(r.report.converted.length, 1);
});

run("same equation in plain symbols and in LaTeX is shown once", () => {
  const r = P.present({ title: "x", text: "Solve x^2 + 1 = 0 for x.", lines: ["x^{2}+1=0"] });
  assert.strictEqual(kinds(r), "p");
  assert.ok(r.blocks[0].src.includes("$x^{2}+1=0$"));
  const f = P.present({ title: "x", text: "Simplify f(x) = (x^2 - 1)/(x + 1) now.", lines: ["f(x)=\\frac{x^{2}-1}{x+1}"] });
  assert.strictEqual(f.blocks.filter((b) => b.k === "d").length, 1);
});

run("ambiguous notation is preserved exactly", () => {
  for (const text of ["Let B = [x + 1; 2].", "Let M = [1 2 3; 4 5].", "On the interval [0, 1] find the maximum.", "Compute U^*AV."]) {
    const r = P.present({ title: "x", text, lines: [] });
    assert.strictEqual(kinds(r), "p", text);
    assert.ok(r.blocks[0].src.replace(/\$/g, "").startsWith(text.slice(0, 8)), text);
    assert.ok(!/begin\{/.test(r.blocks[0].src), `${text} must not become a matrix`);
  }
});

run("identifiers like I_r and A^T become inline math, ordinary words do not", () => {
  const r = P.present({ title: "x", text: "Show that I_r and A^T are related, and snake_case stays.", lines: [] });
  assert.ok(r.blocks[0].src.includes("$I_r$") && r.blocks[0].src.includes("$A^T$"));
  assert.ok(r.blocks[0].src.includes("snake_case"));
});

run("lines not mentioned in the text follow under a lead-in; none is added when the text already introduces them", () => {
  const a = P.present({ title: "x", text: "Find the inverse of A.", lines: [`A = ${bm([["2", "1"], ["4", "3"]])}`] });
  assert.strictEqual(a.blocks[1].src, "Given matrix:");
  const b = P.present({ title: "x", text: "Compute the following:", lines: [`A = ${bm([["1"]])}`] });
  assert.strictEqual(kinds(b), "pd");
  const c = P.present({ title: "x", text: "", lines: [`A = ${bm([["1"]])}`] });
  assert.strictEqual(kinds(c), "d");
});

run("a conflicting duplicate (different numbers) is shown, not silently dropped", () => {
  const r = P.present({ title: "x", text: "Let A = [1 2; 3 4].", lines: [`A = ${bm([["1", "2"], ["3", "5"]])}`] });
  assert.strictEqual(r.blocks.filter((b) => b.k === "d").length, 2);
});

run("larger matrices and block notation", () => {
  const r = P.present({ title: "x", text: "Let N = [1 2 3 4; 5 6 7 8; 9 10 11 12; 13 14 15 16].", lines: [] });
  assert.strictEqual(r.blocks.find((b) => b.k === "d").src.match(/\\\\/g).length, 3);
});
console.log("all presentation tests passed");
