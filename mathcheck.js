/*
 * Exact math checking in the browser, so Check my work can run on the iPad with no PC.
 *
 * This is a port of the checking half of backend/mathcheck.py: it verifies numbers a student wrote
 * (row operations, RREF, rank, determinant, inverse, transpose, products, solutions, arithmetic and
 * U/V/L/P answers) with exact fractions. It deliberately has no "solve this for me" operations
 * beyond what checking needs. backend/test_ipad_mathcheck.py runs both versions on the same inputs.
 *
 * window.SkybridgeMath = { run(args), runChecks(rawChecks), verdict(reading, rows, mode) }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SkybridgeMath = api;
})(typeof self !== "undefined" ? self : this, () => {
  const MAX_SIZE = 8;
  const MAX_MATRICES = 6;
  const MAX_STEPS = 20;
  const MAX_CHECKS = 24;
  const OPERATIONS = [
    "rank", "rref", "determinant", "inverse", "multiply", "row_operations", "transpose", "evaluate", "solve", "check_answer",
  ];

  // ---- exact fractions (BigInt) ------------------------------------------------------------
  const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
  class Frac {
    constructor(n, d = 1n) {
      if (d === 0n) throw new Error("division by zero");
      if (d < 0n) { n = -n; d = -d; }
      const g = gcd(n, d) || 1n;
      this.n = n / g;
      this.d = d / g;
    }
    add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
    div(o) { if (o.n === 0n) throw new Error("division by zero"); return new Frac(this.n * o.d, this.d * o.n); }
    neg() { return new Frac(-this.n, this.d); }
    eq(o) { return this.n === o.n && this.d === o.d; }
    isZero() { return this.n === 0n; }
    pow(k) { let out = new Frac(1n); const base = k < 0 ? new Frac(1n).div(this) : this; for (let i = 0; i < Math.abs(k); i += 1) out = out.mul(base); return out; }
    toString() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
  }
  const ZERO = new Frac(0n);
  const ONE = new Frac(1n);
  const fmt = (value) => value.toString();
  const fmtMatrix = (matrix) => matrix.map((row) => row.map(fmt).join(", ")).join("; ");
  const fmtVector = (vector) => vector.map(fmt).join("; ");

  // "0.5", "1e2", "3" -> exact fraction, like Python's Fraction(str)
  function decimal(text) {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!m || (!m[2] && !m[3])) return null;
    const digits = (m[2] || "") + (m[3] || "");
    let n = BigInt(digits || "0");
    let d = 10n ** BigInt((m[3] || "").length);
    if (m[4]) {
      const e = parseInt(m[4], 10);
      if (Math.abs(e) > 64) return null;
      if (e >= 0) n *= 10n ** BigInt(e); else d *= 10n ** BigInt(-e);
    }
    return new Frac(m[1] === "-" ? -n : n, d);
  }

  // ---- arithmetic ---------------------------------------------------------------------------
  function evaluate(expression) {
    const text = String(expression ?? "").replace(/\*\*/g, "^").replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
    if (!text.trim() || text.length > 200) throw new Error("give a short arithmetic expression");
    const tokens = [];
    const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|(.))/gi;
    let m;
    while ((m = re.exec(text)) && m[0] !== "") {
      if (m[1] !== undefined) tokens.push({ num: m[1] });
      else if (m[2] !== undefined && m[2].trim()) tokens.push({ op: m[2] });
    }
    let pos = 0;
    const fail = () => new Error(`can't read '${expression}'`);
    const peek = () => tokens[pos];
    function atom() {
      const t = tokens[pos];
      if (!t) throw fail();
      if (t.num !== undefined) { pos += 1; const v = decimal(t.num); if (!v) throw fail(); return v; }
      if (t.op === "(") {
        pos += 1;
        const v = sum();
        if (!peek() || peek().op !== ")") throw fail();
        pos += 1;
        return v;
      }
      throw new Error("only numbers, + - * / ^ and brackets are supported");
    }
    function power() {
      const base = atom();
      if (peek() && peek().op === "^") {
        pos += 1;
        const exp = unary(); // right-associative, and -x is allowed in the exponent
        if (exp.d !== 1n || (exp.n < 0n ? -exp.n : exp.n) > 64n) throw new Error("only whole powers up to 64");
        return base.pow(Number(exp.n));
      }
      return base;
    }
    function unary() {
      const t = peek();
      if (t && (t.op === "-" || t.op === "+")) { pos += 1; const v = unary(); return t.op === "-" ? v.neg() : v; }
      return power();
    }
    function product() {
      let v = unary();
      while (peek() && (peek().op === "*" || peek().op === "/")) {
        const op = tokens[pos].op;
        pos += 1;
        const r = unary();
        v = op === "*" ? v.mul(r) : v.div(r);
      }
      return v;
    }
    function sum() {
      let v = product();
      while (peek() && (peek().op === "+" || peek().op === "-")) {
        const op = tokens[pos].op;
        pos += 1;
        const r = product();
        v = op === "+" ? v.add(r) : v.sub(r);
      }
      return v;
    }
    const value = sum();
    if (pos < tokens.length) throw fail();
    return value;
  }

  function number(raw) {
    const text = String(raw).trim().replace(/−/g, "-").replace(/\s+/g, "");
    if (!text) throw new Error("an entry is empty");
    const simple = /^([+-]?\d+)\/(\d+)$/.exec(text);
    if (simple && BigInt(simple[2]) !== 0n) return new Frac(BigInt(simple[1]), BigInt(simple[2]));
    const dec = decimal(text);
    if (dec) return dec;
    return evaluate(text);
  }

  // ---- matrices -----------------------------------------------------------------------------
  const trimBrackets = (s) => s.trim().replace(/^[[\]()]+|[[\]()]+$/g, "");

  function parseMatrix(value) {
    let rows;
    if (Array.isArray(value)) {
      rows = value.map((row) => (Array.isArray(row) ? row : String(row).split(",")).map((cell) => number(String(cell))));
    } else {
      const text = trimBrackets(String(value ?? ""));
      if (!text) throw new Error("the matrix is empty");
      rows = text.split(/[;\n]|\\\\|\]\s*,?\s*\[/)
        .filter((row) => trimBrackets(row))
        .map((row) => trimBrackets(row).split(/[,&\s]+/).filter((cell) => cell.trim()).map(number));
    }
    if (!rows.length || !rows[0].length) throw new Error("the matrix is empty");
    if (rows.some((row) => row.length !== rows[0].length)) throw new Error("rows have different lengths");
    if (rows.length > MAX_SIZE || rows[0].length > MAX_SIZE) throw new Error(`matrices up to ${MAX_SIZE}x${MAX_SIZE} only`);
    return rows;
  }

  function parseVector(value) {
    const m = parseMatrix(value);
    if (m.length === 1) return m[0];
    if (m.every((row) => row.length === 1)) return m.map((row) => row[0]);
    throw new Error("b must be a single row or column of numbers");
  }

  const copy = (m) => m.map((row) => row.slice());

  function rref(matrix) {
    const m = copy(matrix);
    const rows = m.length;
    const cols = m[0].length;
    const pivots = [];
    let r = 0;
    for (let c = 0; c < cols; c += 1) {
      let pivot = -1;
      for (let i = r; i < rows; i += 1) if (!m[i][c].isZero()) { pivot = i; break; }
      if (pivot < 0) continue;
      [m[r], m[pivot]] = [m[pivot], m[r]];
      const lead = m[r][c];
      m[r] = m[r].map((x) => x.div(lead));
      for (let i = 0; i < rows; i += 1) {
        if (i !== r && !m[i][c].isZero()) {
          const factor = m[i][c];
          m[i] = m[i].map((a, j) => a.sub(factor.mul(m[r][j])));
        }
      }
      pivots.push(c);
      r += 1;
      if (r === rows) break;
    }
    return [m, pivots];
  }

  function determinant(matrix) {
    if (matrix.length !== matrix[0].length) throw new Error("the determinant needs a square matrix");
    const m = copy(matrix);
    const n = m.length;
    let det = ONE;
    for (let c = 0; c < n; c += 1) {
      let pivot = -1;
      for (let i = c; i < n; i += 1) if (!m[i][c].isZero()) { pivot = i; break; }
      if (pivot < 0) return ZERO;
      if (pivot !== c) { [m[c], m[pivot]] = [m[pivot], m[c]]; det = det.neg(); }
      det = det.mul(m[c][c]);
      for (let i = c + 1; i < n; i += 1) {
        const factor = m[i][c].div(m[c][c]);
        m[i] = m[i].map((a, j) => a.sub(factor.mul(m[c][j])));
      }
    }
    return det;
  }

  function inverse(matrix) {
    const n = matrix.length;
    if (n !== matrix[0].length) throw new Error("only square matrices have inverses");
    const augmented = matrix.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO))));
    const [reduced, pivots] = rref(augmented);
    for (let i = 0; i < n; i += 1) if (pivots[i] !== i) return null;
    return reduced.map((row) => row.slice(n));
  }

  function multiply(a, b) {
    if (a[0].length !== b.length) throw new Error(`can't multiply ${a.length}x${a[0].length} by ${b.length}x${b[0].length}`);
    return a.map((row) => b[0].map((_, j) => row.reduce((sum, x, k) => sum.add(x.mul(b[k][j])), ZERO)));
  }

  const same = (a, b) => a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((x, j) => x.eq(b[i][j])));

  function compareMatrix(result, claimed) {
    const mine = parseMatrix(claimed);
    if (mine.length !== result.length || mine[0].length !== result[0].length) {
      return { matches: false, difference: `the answer is ${result.length}x${result[0].length}, not ${mine.length}x${mine[0].length}` };
    }
    for (let i = 0; i < result.length; i += 1) {
      for (let j = 0; j < result[i].length; j += 1) {
        if (!result[i][j].eq(mine[i][j])) {
          return { matches: false, difference: `row ${i + 1}, column ${j + 1} should be ${fmt(result[i][j])}, not ${fmt(mine[i][j])}` };
        }
      }
    }
    return { matches: true };
  }

  // ---- row operations -----------------------------------------------------------------------
  const ROW = "R\\s*(\\d+)";
  const SWAP = new RegExp(`^(?:swap\\s*)?${ROW}\\s*(?:<->|<>|,|\\s)\\s*${ROW}$`, "i");
  const SCALE = new RegExp(`^${ROW}\\s*(?:\\*|x|×)\\s*(.+)$|^(.+?)\\s*\\*?\\s*${ROW}$`, "i");
  const SCALE_DIV = new RegExp(`^${ROW}\\s*/\\s*(.+)$`, "i");
  const ADD = new RegExp(`^${ROW}\\s*([+-])\\s*(.*?)\\s*\\*?\\s*${ROW}$`, "i");
  const ASSIGN = new RegExp(`^${ROW}\\s*(?:->|→|=|<-|←)\\s*(.+)$`, "i");

  function rowIndex(m, n) {
    const index = parseInt(n, 10) - 1;
    if (!(index >= 0 && index < m.length)) throw new Error(`there is no row R${n}`);
    return index;
  }

  function applyRowOperation(matrix, step) {
    let text = step.trim().replace(/−/g, "-");
    const assign = ASSIGN.exec(text);
    if (assign) { // "R2 -> R2 - 2R1" is the same as "R2 - 2R1"
      const target = assign[1];
      const rest = assign[2].trim();
      const lead = new RegExp(`^${ROW}\\s*[+-]`, "i").exec(rest);
      if (lead && parseInt(lead[1], 10) === parseInt(target, 10)) text = rest;
      else if (new RegExp(`^${ROW}$`, "i").test(rest)) text = `swap R${target} ${rest}`;
    }
    const m = copy(matrix);
    let match = SWAP.exec(text);
    if (match) {
      const i = rowIndex(m, match[1]);
      const j = rowIndex(m, match[2]);
      [m[i], m[j]] = [m[j], m[i]];
      return m;
    }
    match = ADD.exec(text);
    if (match) {
      const [, target, sign, factor, source] = match;
      const i = rowIndex(m, target);
      const j = rowIndex(m, source);
      let k = factor.trim() ? number(factor) : ONE;
      if (sign === "-") k = k.neg();
      if (i === j) throw new Error(`'${step}' adds a row to itself`);
      m[i] = m[i].map((a, c) => a.add(k.mul(m[j][c])));
      return m;
    }
    match = SCALE_DIV.exec(text);
    if (match) {
      const i = rowIndex(m, match[1]);
      const k = number(match[2]);
      if (k.isZero()) throw new Error("can't divide a row by 0");
      m[i] = m[i].map((a) => a.div(k));
      return m;
    }
    match = SCALE.exec(text);
    if (match) {
      const [row, factor] = match[1] ? [match[1], match[2]] : [match[4], match[3]];
      const i = rowIndex(m, row);
      const k = number(factor);
      if (k.isZero()) throw new Error("scaling a row by 0 is not a valid row operation");
      m[i] = m[i].map((a) => a.mul(k));
      return m;
    }
    throw new Error(`can't read the row operation '${step}'`);
  }

  // ---- solving Ax = b (only to check a student's x) -----------------------------------------
  function solve(a, b) {
    if (b.length !== a.length) throw new Error(`b needs ${a.length} entries, not ${b.length}`);
    const cols = a[0].length;
    const [reduced, pivots] = rref(a.map((row, i) => row.concat([b[i]])));
    if (pivots.includes(cols)) return [null, []];
    const x = Array.from({ length: cols }, () => ZERO);
    pivots.forEach((c, r) => { x[c] = reduced[r][cols]; });
    const basis = [];
    for (let f = 0; f < cols; f += 1) {
      if (pivots.includes(f)) continue;
      const v = Array.from({ length: cols }, () => ZERO);
      v[f] = ONE;
      pivots.forEach((c, r) => { v[c] = reduced[r][f].neg(); });
      basis.push(v);
    }
    return [x, basis];
  }

  // ---- grading a student's own U, V, L or P --------------------------------------------------
  function isRowEchelon(m, leadingOnes) {
    let last = -1;
    let zeroSeen = false;
    for (const row of m) {
      const lead = row.findIndex((x) => !x.isZero());
      if (lead < 0) { zeroSeen = true; continue; }
      if (zeroSeen || lead <= last || (leadingOnes && !row[lead].eq(ONE))) return false;
      last = lead;
    }
    return true;
  }

  function squareInvertible(name, m, size, problems) {
    if (m.length !== size || m[0].length !== size) problems.push(`${name} must be ${size}x${size}, not ${m.length}x${m[0].length}`);
    else if (determinant(m).isZero()) problems.push(`${name} is not invertible (its determinant is 0)`);
  }

  const present = (value) => String(value ?? "").trim() !== "";

  function checkAnswer(a, args, out) {
    const given = {};
    for (const key of ["u", "v", "l", "p"]) if (present(args[key])) given[key] = parseMatrix(args[key]);
    const target = present(args.target) ? parseMatrix(args.target) : null;
    const rows = a.length;
    const cols = a[0].length;
    const problems = [];
    if (given.l) {
      if (!given.u) throw new Error("check_answer for LU needs both l and u");
      const { l, u } = given;
      squareInvertible("L", l, rows, problems);
      if (!problems.length) {
        let upper = false;
        for (let i = 0; i < rows; i += 1) for (let j = i + 1; j < rows; j += 1) if (!l[i][j].isZero()) upper = true;
        if (upper) problems.push("L is not lower triangular");
      }
      if (!isRowEchelon(u, false)) problems.push("U is not in row-echelon form");
      let left = a;
      if (given.p) {
        const p = given.p;
        const isOne = (x) => x.eq(ONE);
        const okLine = (line) => line.filter(isOne).length === 1 && line.filter((x) => x.isZero()).length === rows - 1;
        if (p.length !== rows || !p.every(okLine) || !p[0].map((_, j) => p.map((row) => row[j])).every(okLine)) {
          problems.push("P is not a permutation matrix");
        } else {
          left = multiply(p, a);
        }
      }
      if (!problems.length) {
        const product = multiply(l, u);
        out.LU = fmtMatrix(product);
        if (!same(product, left)) {
          problems.push(`${given.p ? "LU does not equal PA" : "LU does not equal A"} (${compareMatrix(left, fmtMatrix(product)).difference})`);
        }
      }
      out.checked = given.p ? "PA = LU" : "A = LU";
    } else if (given.u && given.v) {
      const { u, v } = given;
      squareInvertible("U", u, rows, problems);
      squareInvertible("V", v, cols, problems);
      if (!problems.length) {
        const product = multiply(multiply(u, a), v);
        const r = rref(a)[1].length;
        const block = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === j && i < r ? ONE : ZERO)));
        out.UAV = fmtMatrix(product);
        if (!same(product, block)) problems.push(`UAV should be ${fmtMatrix(block)} (rank ${r}), but it is ${fmtMatrix(product)}`);
      }
      out.checked = "UAV = [I_r 0; 0 0] with U and V invertible";
    } else if (given.u) {
      const { u } = given;
      squareInvertible("U", u, rows, problems);
      if (!problems.length) {
        const product = multiply(u, a);
        out.UA = fmtMatrix(product);
        if (target) {
          if (!same(product, target)) problems.push(`UA does not equal the target: ${compareMatrix(target, fmtMatrix(product)).difference}`);
          out.checked = "UA = target with U invertible";
        } else {
          const reduced = rref(a)[0];
          if (!same(product, reduced)) problems.push(`UA is ${fmtMatrix(product)}, which is not the RREF of A (${fmtMatrix(reduced)})`);
          out.checked = "UA = RREF of A with U invertible";
        }
      }
    } else {
      throw new Error("check_answer needs the user's u (and v, or l, or p) next to A in matrix");
    }
    out.correct = problems.length === 0;
    if (problems.length) out.problems = problems;
    out.note = "Graded against the problem's conditions, so any valid answer passes.";
    return out;
  }

  // ---- one check ------------------------------------------------------------------------------
  function loads(value) {
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try { return JSON.parse(value); } catch { return value; }
    }
    return value;
  }

  const ALIASES = {
    row_ops: "row_operations", row_operation: "row_operations", det: "determinant", product: "multiply",
    inv: "inverse", reduce: "rref", echelon: "rref", arithmetic: "evaluate",
  };

  function run(rawArgs) {
    const args = loads(rawArgs);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
    let op = String(args.operation ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
    op = ALIASES[op] || op;
    if (!OPERATIONS.includes(op)) throw new Error(`operation must be one of ${OPERATIONS.join(", ")}`);
    let compare = args.compare;
    if (compare === undefined || compare === null || compare === "") compare = null;
    const out = { operation: op };

    if (op === "evaluate") {
      const value = evaluate(args.expression || args.matrix || "");
      out.result = fmt(value);
      if (compare !== null) out.matches = value.eq(number(String(compare)));
      return out;
    }

    if (op === "multiply") {
      let parts = String(args.matrices ?? "").split("|").filter((part) => part.trim());
      if (!parts.length && args.matrix) parts = [args.matrix];
      if (parts.length < 2) throw new Error("multiply needs at least two matrices in matrices, separated by |");
      if (parts.length > MAX_MATRICES) throw new Error(`multiply up to ${MAX_MATRICES} matrices at once`);
      let result = parseMatrix(parts[0]);
      for (const part of parts.slice(1)) result = multiply(result, parseMatrix(part));
      out.result = fmtMatrix(result);
      if (compare !== null) Object.assign(out, compareMatrix(result, compare));
      return out;
    }

    const matrix = parseMatrix(args.matrix);
    const size = `${matrix.length}x${matrix[0].length}`;
    if (op === "check_answer") return checkAnswer(matrix, args, out);
    if (op === "solve") return solveCheck(matrix, args, compare, out);

    let result = null;
    if (op === "transpose") {
      result = matrix[0].map((_, j) => matrix.map((row) => row[j]));
      out.result = fmtMatrix(result);
    } else if (op === "row_operations") {
      const steps = String(args.steps ?? "").split(/[;\n]+/).filter((s) => s.trim());
      if (!steps.length) throw new Error('row_operations needs steps, e.g. "R2 - 2R1; swap R1 R2"');
      if (steps.length > MAX_STEPS) throw new Error(`up to ${MAX_STEPS} steps at once`);
      result = matrix;
      const after = [];
      for (const step of steps) {
        result = applyRowOperation(result, step);
        after.push({ step: step.trim(), matrix: fmtMatrix(result) });
      }
      out.after_each_step = after;
      out.result = fmtMatrix(result);
    } else if (op === "rank" || op === "rref") {
      const [reduced, pivots] = rref(matrix);
      out.rank = pivots.length;
      out.pivot_columns = pivots.map((c) => c + 1);
      if (op === "rref") { result = reduced; out.result = fmtMatrix(reduced); } else { out.result = String(pivots.length); }
      if (matrix.length === matrix[0].length) out.invertible = pivots.length === matrix.length;
      out.size = size;
    } else if (op === "determinant") {
      const value = determinant(matrix);
      out.result = fmt(value);
      out.invertible = !value.isZero();
    } else if (op === "inverse") {
      const inv = inverse(matrix);
      if (!inv) {
        out.result = "none: the matrix is singular (determinant 0)";
        out.invertible = false;
        if (compare !== null) out.matches = false;
        return out;
      }
      result = inv;
      out.result = fmtMatrix(inv);
      out.invertible = true;
    }

    if (compare !== null) {
      if (op === "determinant" || op === "rank") out.matches = number(out.result).eq(number(String(compare)));
      else Object.assign(out, compareMatrix(result, compare));
    }
    return out;
  }

  // Only checks the student's x; it does not hand back a solution.
  function solveCheck(matrix, args, compare, out) {
    const b = parseVector(args.target);
    const [x, basis] = solve(matrix, b);
    if (!x) {
      out.result = "no solution: the system is inconsistent";
      if (compare !== null) out.matches = false;
      return out;
    }
    out.result = basis.length ? `infinitely many: x = particular + any combination of ${basis.length} null space vector(s)` : "unique solution";
    if (compare !== null) {
      const mine = parseVector(compare);
      if (mine.length !== matrix[0].length) {
        out.matches = false;
        out.difference = `x needs ${matrix[0].length} entries`;
      } else {
        const residual = matrix.map((row, i) => row.reduce((s, a, k) => s.add(a.mul(mine[k])), ZERO).sub(b[i]));
        out.matches = residual.every((r) => r.isZero());
        if (!out.matches) out.difference = "A times the user's x is not b";
      }
    }
    return out;
  }

  // ---- the reading's checks, and the verdict (port of backend/checker.py) ---------------------
  const CHECK_FIELDS = ["what", "operation", "matrix", "matrices", "steps", "target", "expression", "compare"];

  function runChecks(rawChecks) {
    const rows = [];
    for (const raw of (Array.isArray(rawChecks) ? rawChecks : []).slice(0, MAX_CHECKS)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const args = {};
      for (const key of CHECK_FIELDS) {
        const value = String(raw[key] ?? "").trim();
        if (value) args[key] = value;
      }
      const what = args.what || args.operation || "a step";
      delete args.what;
      const row = { what, ok: null, detail: "" };
      let result;
      try {
        result = run(args);
      } catch (error) {
        row.detail = `couldn't check (${error.message})`;
        rows.push(row);
        continue;
      }
      if ("matches" in result) {
        row.ok = Boolean(result.matches);
        row.detail = String(result.difference || "");
        if (!row.ok && !row.detail) row.detail = `the right result is ${result.result ?? "?"}`;
      } else if (result.operation === "determinant" && result.result === "0") {
        row.ok = false;
        row.detail = "this matrix has determinant 0, so it is not invertible";
      } else {
        row.ok = true;
        row.detail = `result ${result.result ?? ""}`.trim();
      }
      rows.push(row);
    }
    return rows;
  }

  function hideAnswer(detail) {
    // "row 2, column 3 should be 4, not 5" -> "row 2, column 3 is wrong"
    return detail
      .replace(/\bshould be .*?, not .*$/, "is wrong")
      .replace(/^the right result is .*$/, "the result is wrong")
      .replace(/^the answer is (\d+x\d+), not (\d+x\d+)$/, "the size is wrong ($2)");
  }

  const text = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean).join("\n") : String(value ?? "").trim());

  function verdict(reading, rows, mode) {
    const practice = mode === "practice";
    const checked = rows.filter((r) => r.ok !== null);
    const wrong = checked.filter((r) => r.ok === false);
    const said = text(reading.verdict).toLowerCase();
    let feedback = text(reading.feedback);
    let result;
    let where = "";
    if (wrong.length) {
      const first = wrong[0];
      const detail = practice ? hideAnswer(first.detail) : first.detail;
      result = "wrong";
      where = detail ? `${first.what}: ${detail}` : first.what;
    } else if ((said === "wrong" || said === "incorrect") && !checked.length) {
      result = "wrong";
      where = text(reading.first_mistake);
    } else if (said === "unreadable") {
      result = "unreadable";
    } else if (said === "incomplete") {
      result = "incomplete";
    } else if (said === "wrong" || said === "incorrect") {
      // Every number checks out, so the reader's doubt is about method, not arithmetic.
      result = "unsure";
      where = text(reading.first_mistake);
    } else {
      result = "correct";
    }
    if (practice && result !== "correct") feedback = "";
    return {
      verdict: result, where, steps_checked: checked.length, steps_right: checked.length - wrong.length,
      feedback, transcription: text(reading.transcription), matrices: text(reading.matrices).slice(0, 1200),
    };
  }

  return { run, runChecks, verdict, hideAnswer, evaluate, parseMatrix, multiply, fmt, fmtMatrix };
});
