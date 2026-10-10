/*
 * Check by multiplying: "multiply it out and compare", exactly, with no network and no model.
 *
 * A relation has a left side and a right side, each a product of matrices: U * A = R, L * U = A,
 * P * A = L * U, U * A * V = N. The matrices are typed or read once (by To text) and confirmed by the
 * student; this module only does the arithmetic, with the exact fractions of mathcheck.js. The verdict is
 * Correct, or the first entry that does not match. It never says what the entry should be.
 *
 * window.SkybridgeMatCheck = { PRESETS, parseEntries, matricesIn, fromProblem, check }
 */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./mathcheck.js") : root.SkybridgeMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SkybridgeMatCheck = api;
})(typeof self !== "undefined" ? self : this, (Math_) => {
  // Slots are named; "I" on the right is the identity, sized to match the left product.
  const PRESETS = [
    { id: "ua", label: "U · A = R", left: ["U", "A"], right: ["R"] },
    { id: "uav", label: "U · A · V = N", left: ["U", "A", "V"], right: ["N"] },
    { id: "lu", label: "L · U = A", left: ["L", "U"], right: ["A"] },
    { id: "plu", label: "P · A = L · U", left: ["P", "A"], right: ["L", "U"] },
    { id: "ab", label: "A · B = C", left: ["A", "B"], right: ["C"] },
    { id: "inv", label: "A · B = I (inverse)", left: ["A", "B"], right: ["I"] },
  ];

  const clean = (text) => String(text ?? "")
    .replace(/\\(?:left|right|displaystyle)/g, "")
    .replace(/\\begin\{[a-zA-Z]*matrix\}|\\end\{[a-zA-Z]*matrix\}/g, "")
    .replace(/[−–]/g, "-")
    .replace(/[|]/g, " ");

  // Entries as typed: rows on separate lines (or ; or \\), numbers split by spaces, commas, tabs or &.
  // Fractions (1/2), decimals and signs are all fine. Returns rows of exact fractions.
  function parseEntries(text) {
    const body = clean(text).replace(/^[^=\n]*=\s*(?=[\[(\n\d-])/, "").trim();
    if (!body) throw new Error("no numbers yet");
    const rows = body.split(/\n+|;|\\\\/).map((row) => row.replace(/[[\]()]/g, " ").replace(/&/g, " ").trim()).filter(Boolean);
    return Math_.parseMatrix(rows.map((row) => row.split(/[\s,]+/).filter(Boolean)));
  }

  // Every matrix in some text (a problem, or what To text read): "A = [..]" or a LaTeX matrix, in order.
  function matricesIn(text) {
    const found = [];
    const pattern = /(?:([A-Za-z])\s*=\s*)?\\begin\{[a-zA-Z]*matrix\}([\s\S]*?)\\end\{[a-zA-Z]*matrix\}/g;
    let hit;
    while ((hit = pattern.exec(String(text || "")))) {
      try { found.push({ name: hit[1] || "", rows: parseEntries(hit[2]) }); } catch {}
    }
    return found;
  }

  // The matrices a problem was given with (a homework problem or a practice problem).
  function fromProblem(problem) {
    return matricesIn([problem?.text, ...(problem?.lines || [])].join("\n"));
  }

  const dims = (m) => `${m.length}×${m[0].length}`;

  function product(list, names) {
    let out = list[0];
    for (let i = 1; i < list.length; i += 1) {
      if (out[0].length !== list[i].length) {
        throw new Error(`${names[i - 1]} is ${dims(out)} and ${names[i]} is ${dims(list[i])}, so they can't be multiplied`);
      }
      out = Math_.multiply(out, list[i]);
    }
    return out;
  }

  const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => Math_.parseMatrix([[i === j ? "1" : "0"]])[0][0]));

  // left / right: { names: ["U", "A"], matrices: [rows, rows] } ; a right side of ["I"] is the identity.
  function check(preset, matrices) {
    const names = (side) => side.map((name) => name);
    const get = (name) => {
      const rows = matrices[name];
      if (!rows) throw new Error(`${name} is missing`);
      return rows;
    };
    try {
      const left = product(preset.left.map(get), names(preset.left));
      const rightIsI = preset.right.length === 1 && preset.right[0] === "I";
      let right;
      if (rightIsI) {
        if (left.length !== left[0].length) return { ok: true, verdict: "wrong", text: `${preset.left.join(" · ")} is ${dims(left)}, so it can't be the identity.` };
        right = identity(left.length);
      } else {
        right = product(preset.right.map(get), names(preset.right));
      }
      const leftText = preset.left.join(" · ");
      const rightText = preset.right.join(" · ");
      if (left.length !== right.length || left[0].length !== right[0].length) {
        return { ok: true, verdict: "wrong", text: `${leftText} is ${dims(left)} but ${rightText} is ${dims(right)}, so they can't be equal. Check the sizes.` };
      }
      for (let i = 0; i < left.length; i += 1) {
        for (let j = 0; j < left[i].length; j += 1) {
          if (!left[i][j].eq(right[i][j])) {
            return { ok: true, verdict: "wrong", row: i + 1, column: j + 1, text: `Multiplying out, ${leftText} and ${rightText} first differ at row ${i + 1}, column ${j + 1}. One of the matrices has a wrong number that affects that entry.` };
          }
        }
      }
      return { ok: true, verdict: "correct", text: `Correct: ${leftText} = ${rightText}, multiplied out exactly.` };
    } catch (error) {
      return { ok: false, error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
    }
  }

  return { PRESETS, parseEntries, matricesIn, fromProblem, check };
});
