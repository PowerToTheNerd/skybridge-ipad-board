/*
 * Help sheets: one-page linear algebra reference sheets, bundled with the app (no network, no Gemini).
 * Worked examples use general matrices of their own, not anyone's homework, and never solve an assignment.
 *
 * The sheets are typeset on a canvas by a small layout engine below (text, matrices, notes), so the very same
 * picture shows beside the board, pins onto a page, saves as an image and prints. Every example matrix lives in
 * EX as numbers; backend/test_ipad_helpsheets.py checks each identity with SymPy.
 *
 * window.SkybridgeHelp = { sheets, examples, render(id, opts), open(id), close(), toggle(), isOpen() }
 */
(() => {
  const root = typeof window !== "undefined" ? window : globalThis;
  const MINUS = "−";

  // ---------------------------------------------------------------------------
  // Example matrices (numbers; "1/3" style strings for fractions)
  // ---------------------------------------------------------------------------
  const EX = {
    elem: {
      swap: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
      scale: [[1, 0, 0], [0, 3, 0], [0, 0, 1]],
      scaleInv: [[1, 0, 0], [0, "1/3", 0], [0, 0, 1]],
      add: [[1, 0, 0], [0, 1, 0], [-2, 0, 1]],
      addInv: [[1, 0, 0], [0, 1, 0], [2, 0, 1]],
      A: [[1, 2, 0], [3, 1, 4], [2, 5, 1]],
      EA: [[1, 2, 0], [3, 1, 4], [0, 1, 1]],
    },
    rref: {
      A: [[1, 2, 1], [2, 4, 3], [1, 2, 2]],
      I: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      steps: [
        [[1, 0, 0], [-2, 1, 0], [0, 0, 1]],
        [[1, 0, 0], [0, 1, 0], [-1, 0, 1]],
        [[1, 0, 0], [0, 1, 0], [0, -1, 1]],
        [[1, -1, 0], [0, 1, 0], [0, 0, 1]],
      ],
      R: [[1, 2, 0], [0, 0, 1], [0, 0, 0]],
      U: [[3, -1, 0], [-2, 1, 0], [1, -1, 1]],
    },
    inv: {
      A3: [[1, 2, 0], [0, 1, 3], [0, 0, 1]],
      A3inv: [[1, -2, 6], [0, 1, -3], [0, 0, 1]],
      steps: [[[1, 0, 0], [0, 1, -3], [0, 0, 1]], [[1, -2, 0], [0, 1, 0], [0, 0, 1]]],
      stepsInv: [[[1, 0, 0], [0, 1, 3], [0, 0, 1]], [[1, 2, 0], [0, 1, 0], [0, 0, 1]]],
      A2: [[2, 1], [5, 3]],
      A2inv: [[3, -1], [-5, 2]],
    },
    lu: {
      A: [[2, 1, 1], [4, 3, 3], [8, 7, 9]],
      L: [[1, 0, 0], [2, 1, 0], [4, 3, 1]],
      U: [[2, 1, 1], [0, 1, 1], [0, 0, 2]],
    },
    plu: {
      A: [[1, 2, 1], [2, 4, 3], [3, 5, 4]],
      P: [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
      PA: [[1, 2, 1], [3, 5, 4], [2, 4, 3]],
      L: [[1, 0, 0], [3, 1, 0], [2, 0, 1]],
      U: [[1, 2, 1], [0, -1, 1], [0, 0, 1]],
      cycle: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    },
    rank: {
      V: [[1, 0, -2], [0, 0, 1], [0, 1, 0]],
      N: [[1, 0, 0], [0, 1, 0], [0, 0, 0]],
      r: 2,
    },
  };

  // ---------------------------------------------------------------------------
  // Content: small builders, then the six sheets
  // ---------------------------------------------------------------------------
  const FRACS = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾" };
  const fmt = (value) => {
    if (typeof value === "number") return value < 0 ? MINUS + -value : String(value);
    const text = String(value);
    if (text[0] === "-") return MINUS + fmt(text.slice(1));
    return FRACS[text] || text;
  };
  // A matrix to draw: rows of numbers or text; aug = how many columns sit left of a dashed divider; hi = [row, col] pairs to colour.
  const mat = (rows, options = {}) => ({ m: rows.map((row) => row.map(fmt)), aug: options.aug || 0, hi: options.hi || [] });
  const augment = (left, right) => mat(left.map((row, i) => [...row, ...right[i]]), { aug: left[0].length });

  const P = (t) => ({ k: "p", t });
  const H = (t) => ({ k: "h", t });
  const UL = (...items) => ({ k: "ul", items });
  const OL = (...items) => ({ k: "ol", items });
  const EQ = (...items) => ({ k: "eq", items });
  const T = (t) => ({ t });
  const NOTE = (kind, title, ...body) => ({ k: "note", kind, title, body });

  const E = EX.elem;
  const RR = EX.rref;
  const IV = EX.inv;
  const LU = EX.lu;
  const PL = EX.plu;
  const RK = EX.rank;

  const SHEETS = [
    {
      id: "elementary",
      tab: "Elementary",
      title: "Elementary matrices",
      sub: "One row operation, written as a matrix",
      blocks: [
        P("An **elementary matrix** is the identity matrix with **one** row operation done to it. Multiplying by it on the **left** does that same row operation to any matrix: `E A` changes the rows of `A`."),
        H("The three types (shown 3×3)"),
        NOTE("card", "1 · Swap two rows",
          EQ("P_{12} =", mat(E.swap), T("swaps R_1 and R_2")),
          P("Inverse: itself. Swapping twice undoes the swap.")),
        NOTE("card", "2 · Scale a row by c ≠ 0",
          EQ("D =", mat(E.scale, { hi: [[1, 1]] }), T("multiplies R_2 by 3")),
          EQ("D^{-1} =", mat(E.scaleInv, { hi: [[1, 1]] }), T("multiplies R_2 by ⅓")),
          P("Inverse: scale by `1/c`. Scaling by 0 is not allowed.")),
        NOTE("card", "3 · Add a multiple of one row to another",
          EQ("E =", mat(E.add, { hi: [[2, 0]] }), T("R_3 → R_3 − 2R_1")),
          EQ("E^{-1} =", mat(E.addInv, { hi: [[2, 0]] }), T("R_3 → R_3 + 2R_1")),
          P("Inverse: the same entry with its **sign flipped**.")),
        H("Build it, then check it"),
        OL("Write the identity matrix `I`.", "Do the row operation to `I`, and nothing else. The result is `E`.", "Test it on a small matrix: `E A` must be `A` with that same operation done."),
        EQ("E", mat(E.add, { hi: [[2, 0]] }), "·", mat(E.A), "=", mat(E.EA, { hi: [[2, 0], [2, 1], [2, 2]] })),
        P("Row 3 became (row 3) − 2·(row 1); the other rows did not change."),
        H("Several steps: the order flips"),
        P("Do operation 1, then 2, then 3. The matrix is `E_3 E_2 E_1`: the **latest step goes leftmost**, because each new step multiplies on the left of everything done so far."),
        NOTE("warn", "Common mistakes",
          UL("Writing `E_1 E_2 E_3` for steps done in the order 1, 2, 3.",
            "Forgetting to flip the sign in the inverse of an add-type matrix.",
            "Multiplying on the right: `A E` does the operation to **columns**, not rows.",
            "Scaling a row by 0, which can't be undone (not invertible).")),
      ],
    },
    {
      id: "rref",
      tab: "RREF & U",
      title: "Row reduce: find U with UA = R",
      sub: "and write U as a product of elementary matrices",
      blocks: [
        P("Every row operation is a left multiplication by an elementary matrix. After `k` steps: `E_k · · · E_2 E_1 A = R`. Call `U = E_k · · · E_2 E_1`. Then `U A = R`, and `U` is **invertible**, because it is a product of invertible matrices."),
        H("Fast way: reduce [ A | I ]"),
        OL("Write `A` and the identity side by side.", "Row reduce the **whole** thing until the left side is `R` (RREF).", "The right side went through the same steps as `I`, so it ends as `U`."),
        EQ(augment(RR.A, RR.I), "→", augment(RR.R, RR.U)),
        H("Example (a general one, not from homework)"),
        P("Steps used: `R_2 − 2R_1`, `R_3 − R_1`, `R_3 − R_2`, `R_1 − R_2`. As elementary matrices:"),
        EQ("E_1 =", mat(RR.steps[0], { hi: [[1, 0]] }), "E_2 =", mat(RR.steps[1], { hi: [[2, 0]] })),
        EQ("E_3 =", mat(RR.steps[2], { hi: [[2, 1]] }), "E_4 =", mat(RR.steps[3], { hi: [[0, 1]] })),
        P("Multiply with the **latest step on the left**:"),
        EQ("U = E_4 E_3 E_2 E_1 =", mat(RR.U)),
        P("Check by multiplying (this is the × button in the top bar, offline):"),
        EQ("U A =", mat(RR.U), mat(RR.A), "=", mat(RR.R)),
        P("`R` is in RREF. When `A` is not invertible, `U` is **not unique**: another valid order of steps gives another `U`, still with `U A = R`."),
        H("If the question asks for a product"),
        P("`U = E_4 E_3 E_2 E_1`: the matrices in **reverse** order of the steps. To write `A` itself: `A = U^{-1} R = E_1^{-1} E_2^{-1} E_3^{-1} E_4^{-1} R`: inverses in the **original** order, each one with its sign flipped."),
        NOTE("check", "Check yourself",
          UL("Multiply `U A`. Do you get `R`?",
            "RREF: every leading entry is 1, it is the only nonzero entry in its column, leading 1s move right going down, zero rows at the bottom.",
            "The number of `E` matrices in `U` equals the number of row operations you wrote.")),
        NOTE("warn", "Common mistakes",
          UL("Doing a step on `A` but not on the `I` side.",
            "Reversing the product (`E_1 E_2 E_3 E_4`).",
            "Stopping at echelon form. RREF also clears the entries **above** each leading 1 (step 4 here).",
            "One arithmetic slip: after each step, re-add the row you changed.")),
      ],
    },
    {
      id: "inverse",
      tab: "Inverses",
      title: "Inverses",
      sub: "Finding A⁻¹, and writing A as a product of elementary matrices",
      blocks: [
        P("A square matrix `A` is invertible exactly when its RREF is `I` (a pivot in every row and column). If a zero row appears, `A` is **not** invertible."),
        H("Find A^{-1} with [ A | I ] → [ I | A^{-1} ]".replace(/\^\{-1\}/g, "⁻¹")),
        EQ(augment(IV.A3, RR.I), "→", augment(RR.I, IV.A3inv)),
        P("Steps here: `R_2 − 3R_3`, then `R_1 − 2R_2`."),
        H("Two by two shortcut"),
        EQ(mat([["a", "b"], ["c", "d"]]), "^{-1} =", "1/(ad − bc)", mat([["d", "-b"], ["-c", "a"]])),
        P("Only when `ad − bc ≠ 0`. Example, with `2·3 − 1·5 = 1`:"),
        EQ(mat(IV.A2), "^{-1} =", mat(IV.A2inv)),
        H("A as a product of elementary matrices"),
        P("Reduce `A` to `I`, noting each step. For the 3×3 matrix above, `E_2 E_1 A = I` with `E_1` = (`R_2 − 3R_3`) and `E_2` = (`R_1 − 2R_2`). So `A = E_1^{-1} E_2^{-1}`:"),
        EQ("A =", mat(IV.stepsInv[0], { hi: [[1, 2]] }), mat(IV.stepsInv[1], { hi: [[0, 1]] }), "=", mat(IV.A3)),
        H("Facts to use"),
        UL("`A A^{-1} = A^{-1} A = I`. Check by multiplying.",
          "`(A B)^{-1} = B^{-1} A^{-1}`: the order **reverses**.",
          "`(A^T)^{-1} = (A^{-1})^T`.",
          "If `E_k · · · E_1 A = I`, then `A^{-1} = E_k · · · E_1` and `A = E_1^{-1} · · · E_k^{-1}`."),
        NOTE("warn", "Common mistakes",
          UL("Using the 2×2 formula on a bigger matrix.",
            "Inverting entry by entry. The inverse of [a b; c d] is **not** [1/a 1/b; 1/c 1/d].",
            "Forgetting that `(A B)^{-1}` reverses the order.",
            "Calling `A` invertible without checking for a pivot in every row.")),
      ],
    },
    {
      id: "lu",
      tab: "LU & PA = LU",
      title: "LU and PA = LU",
      sub: "Triangular factors, and the permutation matrix that tracks row swaps",
      blocks: [
        P("Elimination with no row swaps gives `A = L U`. `U` is upper triangular (what elimination ends with). `L` is lower triangular with **1s on its diagonal** and holds the multipliers."),
        H("Reading L"),
        P("If a step is `R_i → R_i − m R_j`, then `L` has `m` in row `i`, column `j`: the multiplier is the number you subtract, with its own sign. Here the steps were `R_2 − 2R_1`, `R_3 − 4R_1`, `R_3 − 3R_2`:"),
        EQ("A =", mat(LU.A), "=", mat(LU.L, { hi: [[1, 0], [2, 0], [2, 1]] }), mat(LU.U)),
        H("When you need a permutation matrix P"),
        UL("A pivot spot holds 0 and a row below has a nonzero entry in that column: **swap** those rows.",
          "Keep all swaps in one matrix `P`: start with `P = I` and do each swap to it too. Then `P A = L U`.",
          "`P` has one 1 in each row and column. `P^{-1} = P^T`. `P A` reorders the **rows** of `A`; `A P` reorders its **columns**."),
        EQ("P =", mat(PL.cycle), T("sends row 2 up to row 1, row 3 up to row 2, row 1 to row 3")),
        H("Example with a swap"),
        EQ("A =", mat(PL.A)),
        P("Clear column 1: `R_2 − 2R_1`, `R_3 − 3R_1`. The next pivot spot is 0, but the row below has −1, so **swap** `R_2 ↔ R_3`. Column 2 is then already clear (multiplier 0)."),
        P("The multipliers **travel with their rows**: when rows 2 and 3 swap, swap what you already stored in `L` for those rows too. That is why `L` shows 3 above 2."),
        EQ("P =", mat(PL.P), "P A =", mat(PL.PA)),
        EQ("L =", mat(PL.L), "U =", mat(PL.U)),
        P("Check: `L U` gives `P A` (multiply it out)."),
        H("Solve A x = b with it"),
        OL("`P A x = P b`, which is `L U x = P b`.", "Forward-substitute `L y = P b` (top row first).", "Back-substitute `U x = y` (bottom row first)."),
        NOTE("warn", "Common mistakes",
          UL("Forgetting to swap the earlier multipliers in `L`.",
            "Putting −m in `L` instead of `m`.",
            "Mixing the forms: `P A = L U` is the same as `A = P^T L U`.")),
      ],
    },
    {
      id: "rank",
      tab: "Rank & UAV",
      title: "Rank and U A V = N",
      sub: "Row operations on the left, column operations on the right",
      blocks: [
        P("Any `m×n` matrix of rank `r` can be reduced to the **normal form** `N` by row operations (left multiplication, `U`) **and** column operations (right multiplication, `V`): `U A V = N`, with `N` an identity block `I_r` in the top-left corner and zeros elsewhere."),
        H("Steps"),
        OL("Row reduce: `U A = R` (RREF). The number of pivots is the rank `r`.",
          "Use **column** operations to clear the other entries in each pivot **row** (add multiples of the pivot column to the other columns).",
          "Swap columns so the pivot columns come first.",
          "Do every column operation to an identity matrix too. It ends as `V`."),
        H("Example (continues the RREF sheet)"),
        P("Same `A`, `U` and `R` as there. Column operation `C_2 → C_2 − 2C_1` clears the 2 in row 1; then swap `C_2 ↔ C_3`."),
        EQ("R =", mat(RR.R, { hi: [[0, 1]] }), "V =", mat(RK.V)),
        EQ("R V =", mat(RK.N)),
        EQ("U A V =", mat(RR.U), mat(RR.A), mat(RK.V), "=", mat(RK.N)),
        P("There are 2 pivots, so the rank is `r = 2`: `N` has `I_2` in the corner and one zero row and column left."),
        NOTE("tip", "Left or right?",
          UL("`E A` does the operation to **rows** of `A`.",
            "`A E` does it to **columns** of `A`.",
            "Keep the order `U A V`: the `U` steps on the left, the `V` steps on the right.")),
        NOTE("warn", "Common mistakes",
          UL("Using a row operation when you meant a column one (or the reverse).",
            "Clearing the wrong way: row steps clear down a pivot's **column**; column steps clear along a pivot's **row**.",
            "Forgetting to apply the column steps to `I` to get `V`.")),
      ],
    },
    {
      id: "checklist",
      tab: "Checklist",
      title: "Checklist and quick reference",
      sub: "Run through it before you hand a problem in",
      blocks: [
        H("Which side?"),
        UL("Rows: multiply on the **left**, `E A`.", "Columns: multiply on the **right**, `A E`."),
        H("Each elementary matrix and its inverse"),
        UL("**Swap** `R_i ↔ R_j`: `E` is `I` with those rows swapped. `E^{-1} = E`.",
          "**Scale** `R_i` by `c`: `E` has `c` on the diagonal at `i`. `E^{-1}` has `1/c`.",
          "**Add** `R_i → R_i + k R_j`: `E` has `k` in row `i`, column `j`. `E^{-1}` has `−k`."),
        H("While you work"),
        UL("Write each step in words (`R_3 → R_3 − 2R_1`).",
          "Do every step to **both** halves of `[ A | I ]`.",
          "After each step re-add the row you changed. One slip ruins everything below it."),
        H("Before you finish"),
        UL("Multiply it out: `U A = R`? `A A^{-1} = I`? `L U = P A`? `U A V = N`?",
          "Product order: the latest step is the leftmost matrix.",
          "The inverse of a product reverses the order: `(E_2 E_1)^{-1} = E_1^{-1} E_2^{-1}`.",
          "Is `R` really in RREF? Leading 1s, zeros above and below them."),
        NOTE("tip", "In this app",
          P("The × button in the top bar checks a product of matrices by multiplying them out, with no internet. A help sheet can sit beside the board while you work, or be pinned to a page (it is never sent to Gemini or included when you export).")),
      ],
    },
  ];

  // ---------------------------------------------------------------------------
  // Typesetting on a canvas
  // ---------------------------------------------------------------------------
  const SANS = '-apple-system, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  const SERIF = '"New York", ui-serif, Georgia, "Times New Roman", serif';
  const LIGHT = { bg: "#ffffff", text: "#1c1f24", muted: "#5d6672", accent: "#1f7a5c", rule: "#d8dde3", warn: "#c8553a", check: "#2c8a5a", tip: "#3a6fc4" };

  let measureCtx = null;
  const measurer = () => {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    return measureCtx;
  };

  // The app's own colours, so a sheet beside or on a page looks like part of it.
  function appPalette() {
    try {
      const css = getComputedStyle(document.documentElement);
      const get = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
      return {
        bg: get("--surface", get("--paper", LIGHT.bg)),
        text: get("--text", LIGHT.text),
        muted: get("--muted", LIGHT.muted),
        accent: get("--accent", LIGHT.accent),
        rule: get("--line-strong", LIGHT.rule),
        warn: "#e0735a",
        check: "#4fb583",
        tip: get("--accent", LIGHT.tip),
      };
    } catch {
      return LIGHT;
    }
  }

  // "E_1", "A^{-1}", "R_i": subscripts and superscripts are drawn small and shifted, so no rare Unicode glyphs are needed.
  function mathSegs(text) {
    const tidy = (s) => s.replace(/(^|[\s(=,|])-(?=[\d\w(])/g, "$1" + MINUS).replace(/(\s)-(\s)/g, "$1" + MINUS + "$2");
    const out = [];
    let buf = "";
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if ((c === "_" || c === "^") && i + 1 < text.length) {
        if (buf) { out.push({ t: tidy(buf), k: "n" }); buf = ""; }
        let payload;
        if (text[i + 1] === "{") {
          const end = text.indexOf("}", i + 2);
          payload = text.slice(i + 2, end < 0 ? text.length : end);
          i = end < 0 ? text.length : end;
        } else {
          payload = text[i + 1];
          i += 1;
        }
        out.push({ t: payload.replace(/-/g, MINUS), k: c === "_" ? "sub" : "sup" });
      } else {
        buf += c;
      }
    }
    if (buf) out.push({ t: tidy(buf), k: "n" });
    return out;
  }

  function parseInline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      const token = m[0];
      out.push(token[0] === "*" ? { text: token.slice(2, -2), b: true } : { text: token.slice(1, -1), m: true });
      last = m.index + token.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  const style = (opts) => ({ F: opts.font || 16, pal: opts.pal || LIGHT });
  const sansFont = (px, bold) => `${bold ? "700 " : "400 "}${px}px ${SANS}`;
  const serifFont = (px) => `400 ${px}px ${SERIF}`;

  // A word is a list of drawn pieces: { text, font, color, dy, w }.
  function wordPieces(st, run, text) {
    const ctx = measurer();
    if (!run.m) {
      const font = sansFont(st.F, run.b);
      ctx.font = font;
      return [{ text, font, color: st.pal.text, dy: 0, w: ctx.measureText(text).width }];
    }
    const size = st.F * 1.06;
    return mathSegs(text).map((seg) => {
      const px = seg.k === "n" ? size : size * 0.7;
      const font = serifFont(px);
      ctx.font = font;
      return { text: seg.t, font, color: st.pal.text, dy: seg.k === "sub" ? size * 0.26 : seg.k === "sup" ? -size * 0.36 : 0, w: ctx.measureText(seg.t).width };
    });
  }

  // Greedy line breaking of inline runs into lines of positioned pieces. Pieces with no space between them
  // (a formula followed by a full stop) stay together as one word.
  function wrapRuns(st, runs, maxW) {
    const space = st.F * 0.3;
    const words = [];
    let current = [];
    const flush = () => { if (current.length) words.push(current); current = []; };
    for (const run of runs) {
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) flush();
        else current.push(...wordPieces(st, run, part));
      }
    }
    flush();
    const lines = [[]];
    let x = 0;
    words.forEach((pieces) => {
      const w = pieces.reduce((sum, p) => sum + p.w, 0);
      if (x > 0 && x + w > maxW) { lines.push([]); x = 0; }
      let px = x;
      const line = lines[lines.length - 1];
      pieces.forEach((p) => { line.push({ ...p, x: px }); px += p.w; });
      x += w + space;
    });
    return lines.filter((line) => line.length);
  }

  function drawLines(ctx, lines, x, y, lh) {
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    lines.forEach((line, i) => {
      const cy = y + lh * i + lh / 2;
      line.forEach((p) => {
        ctx.font = p.font;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x + p.x, cy + p.dy);
      });
    });
  }

  function paragraph(st, text, w, opts = {}) {
    const lh = st.F * 1.5;
    const lines = wrapRuns(st, parseInline(text), w);
    return { h: lines.length * lh, draw: (ctx, x, y) => drawLines(ctx, lines, x, y, lh), lines, lh, ...opts };
  }

  function matrixBox(st, spec) {
    const ctx = measurer();
    const size = st.F * 1.1;
    const font = serifFont(size);
    ctx.font = font;
    const rows = spec.m.length;
    const cols = spec.m[0].length;
    const pad = size * 0.5;
    const colW = [];
    for (let c = 0; c < cols; c += 1) {
      let widest = 0;
      for (let r = 0; r < rows; r += 1) {
        const segs = mathSegs(spec.m[r][c]);
        let w = 0;
        segs.forEach((seg) => { ctx.font = serifFont(seg.k === "n" ? size : size * 0.7); w += ctx.measureText(seg.t).width; });
        widest = Math.max(widest, w);
      }
      colW.push(Math.max(widest, size * 0.7) + pad * 2);
    }
    const arm = size * 0.28;
    const edge = size * 0.22;
    const rowH = size * 1.5;
    const inner = colW.reduce((a, b) => a + b, 0);
    const w = inner + (arm + edge) * 2;
    const h = rows * rowH + size * 0.3;
    const hi = new Set(spec.hi.map(([r, c]) => `${r},${c}`));
    return {
      w,
      h,
      matrix: true,
      draw(ctx2, x, cy) {
        const top = cy - h / 2;
        ctx2.save();
        ctx2.strokeStyle = st.pal.text;
        ctx2.lineWidth = Math.max(1.3, size * 0.075);
        ctx2.lineCap = "square";
        ctx2.beginPath();
        ctx2.moveTo(x + arm, top + 2); ctx2.lineTo(x, top + 2); ctx2.lineTo(x, top + h - 2); ctx2.lineTo(x + arm, top + h - 2);
        ctx2.moveTo(x + w - arm, top + 2); ctx2.lineTo(x + w, top + 2); ctx2.lineTo(x + w, top + h - 2); ctx2.lineTo(x + w - arm, top + h - 2);
        ctx2.stroke();
        let cx = x + arm + edge;
        const left = cx;
        if (spec.aug > 0 && spec.aug < cols) {
          const dx = left + colW.slice(0, spec.aug).reduce((a, b) => a + b, 0);
          ctx2.setLineDash([size * 0.18, size * 0.14]);
          ctx2.strokeStyle = st.pal.muted;
          ctx2.lineWidth = 1.2;
          ctx2.beginPath(); ctx2.moveTo(dx, top + size * 0.25); ctx2.lineTo(dx, top + h - size * 0.25); ctx2.stroke();
          ctx2.setLineDash([]);
        }
        ctx2.textBaseline = "middle";
        for (let c = 0; c < cols; c += 1) {
          const mid = cx + colW[c] / 2;
          for (let r = 0; r < rows; r += 1) {
            const segs = mathSegs(spec.m[r][c]);
            const ey = top + size * 0.15 + rowH * r + rowH / 2;
            let total = 0;
            const sized = segs.map((seg) => { const px = seg.k === "n" ? size : size * 0.7; ctx2.font = serifFont(px); const tw = ctx2.measureText(seg.t).width; total += tw; return { seg, px, tw }; });
            let tx = mid - total / 2;
            const lit = hi.has(`${r},${c}`);
            sized.forEach(({ seg, px, tw }) => {
              ctx2.font = lit ? `700 ${px}px ${SERIF}` : serifFont(px);
              ctx2.fillStyle = lit ? st.pal.accent : st.pal.text;
              ctx2.textAlign = "left";
              ctx2.fillText(seg.t, tx, ey + (seg.k === "sub" ? size * 0.24 : seg.k === "sup" ? -size * 0.34 : 0));
              tx += tw;
            });
          }
          cx += colW[c];
        }
        ctx2.restore();
      },
    };
  }

  // A row of text pieces and matrices that wraps onto more lines when it is too wide.
  function equation(st, items, maxW) {
    const ctx = measurer();
    const gap = st.F * 0.55;
    const boxes = items.map((item) => {
      if (typeof item === "string" || item.t !== undefined) {
        const plain = typeof item === "object";
        const text = plain ? item.t : item;
        const size = plain ? st.F * 0.94 : st.F * 1.1;
        const segs = mathSegs(text);
        const font = (px) => (plain ? sansFont(px) : serifFont(px));
        let w = 0;
        const sized = segs.map((seg) => { const px = seg.k === "n" ? size : size * 0.7; ctx.font = font(px); const tw = ctx.measureText(seg.t).width; w += tw; return { seg, px, tw }; });
        return {
          w,
          h: st.F * 1.5,
          glue: !plain && text[0] === "^",
          draw(ctx2, x, cy) {
            ctx2.textBaseline = "middle";
            ctx2.textAlign = "left";
            ctx2.fillStyle = plain ? st.pal.muted : st.pal.text;
            let tx = x;
            sized.forEach(({ seg, px, tw }) => {
              ctx2.font = font(px);
              ctx2.fillText(seg.t, tx, cy + (seg.k === "sub" ? size * 0.24 : seg.k === "sup" ? -size * 0.34 : 0));
              tx += tw;
            });
          },
        };
      }
      return matrixBox(st, item);
    });
    const lines = [[]];
    let x = 0;
    let before = null;
    boxes.forEach((box) => {
      if (x > 0 && x + box.w > maxW) { lines.push([]); x = 0; before = null; }
      if (before && before.matrix && box.matrix) x += st.F * 0.3;
      if (box.glue && before && x > 0) x -= gap;
      lines[lines.length - 1].push({ box, x });
      x += box.w + gap;
      before = box;
    });
    const heights = lines.map((line) => Math.max(...line.map((it) => it.box.h)));
    const lineGap = st.F * 0.3;
    const h = heights.reduce((a, b) => a + b, 0) + lineGap * (lines.length - 1);
    return {
      h,
      draw(ctx2, x0, y) {
        let ly = y;
        lines.forEach((line, i) => {
          line.forEach((it) => it.box.draw(ctx2, x0 + it.x, ly + heights[i] / 2));
          ly += heights[i] + lineGap;
        });
      },
    };
  }

  function listBlock(st, block, w) {
    const indent = st.F * 1.5;
    const lh = st.F * 1.5;
    const gap = st.F * 0.32;
    const rows = block.items.map((text, i) => ({ lines: wrapRuns(st, parseInline(text), w - indent), n: i + 1 }));
    const h = rows.reduce((sum, row) => sum + row.lines.length * lh + gap, 0) - gap;
    return {
      h,
      draw(ctx, x, y) {
        let ly = y;
        rows.forEach((row) => {
          ctx.textBaseline = "middle";
          ctx.fillStyle = st.pal.accent;
          if (block.k === "ol") {
            ctx.font = sansFont(st.F, true);
            ctx.textAlign = "left";
            ctx.fillText(`${row.n}.`, x, ly + lh / 2);
          } else {
            ctx.beginPath();
            ctx.arc(x + st.F * 0.28, ly + lh / 2, st.F * 0.12, 0, Math.PI * 2);
            ctx.fill();
          }
          drawLines(ctx, row.lines, x + indent, ly, lh);
          ly += row.lines.length * lh + gap;
        });
      },
    };
  }

  function noteBlock(st, block, w) {
    const pad = st.F * 0.75;
    const bar = st.F * 0.28;
    const color = block.kind === "warn" ? st.pal.warn : block.kind === "check" ? st.pal.check : block.kind === "tip" ? st.pal.tip : st.pal.muted;
    const inner = w - pad * 2 - bar;
    const title = block.title ? { h: st.F * 1.6 } : { h: 0 };
    const kids = block.body.map((child) => measureBlock(st, child, inner, true));
    const gap = st.F * 0.35;
    const body = kids.reduce((sum, kid) => sum + kid.h, 0) + gap * Math.max(0, kids.length - 1);
    const h = pad + title.h + body + pad * 0.8;
    return {
      h,
      draw(ctx, x, y) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.1;
        roundRect(ctx, x, y, w, h, st.F * 0.5);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y + st.F * 0.3, bar, h - st.F * 0.6);
        ctx.restore();
        let ly = y + pad;
        if (block.title) {
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.font = sansFont(st.F * 1.02, true);
          ctx.fillStyle = block.kind === "card" ? st.pal.text : color;
          ctx.fillText(block.title, x + bar + pad, ly + title.h / 2);
          ly += title.h;
        }
        kids.forEach((kid) => { kid.draw(ctx, x + bar + pad, ly); ly += kid.h + gap; });
      },
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function measureBlock(st, block, w, nested) {
    switch (block.k) {
      case "h": {
        const size = st.F * 1.12;
        return {
          h: size * 1.5 + st.F * 0.5,
          before: nested ? 0 : st.F * 0.5,
          draw(ctx, x, y) {
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.font = sansFont(size, true);
            ctx.fillStyle = st.pal.accent;
            const segs = mathSegs(block.t);
            let tx = x;
            segs.forEach((seg) => {
              ctx.font = sansFont(seg.k === "n" ? size : size * 0.7, true);
              ctx.fillText(seg.t, tx, y + size * 0.75 + (seg.k === "sub" ? size * 0.2 : seg.k === "sup" ? -size * 0.3 : 0));
              tx += ctx.measureText(seg.t).width;
            });
          },
        };
      }
      case "p": return paragraph(st, block.t, w);
      case "ul":
      case "ol": return listBlock(st, block, w);
      case "eq": return equation(st, block.items, w);
      case "note": return noteBlock(st, block, w);
      default: return { h: st.F, draw() {} };
    }
  }

  // Everything on a sheet, measured, ready to be placed on one tall page or paginated.
  function layoutSheet(sheet, width, st) {
    const margin = st.F * 1.6;
    const w = width - margin * 2;
    const items = [];
    const head = {
      h: st.F * 1.2 + st.F * 2.3 + st.F * 1.5 + st.F * 0.9,
      draw(ctx, x, y) {
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.font = sansFont(st.F * 0.72, true);
        ctx.fillStyle = st.pal.accent;
        ctx.fillText("HELP SHEET · LINEAR ALGEBRA", x, y + st.F * 0.6);
        ctx.font = sansFont(st.F * 1.75, true);
        ctx.fillStyle = st.pal.text;
        const segs = mathSegs(sheet.title);
        let tx = x;
        segs.forEach((seg) => {
          ctx.font = sansFont(seg.k === "n" ? st.F * 1.75 : st.F * 1.2, true);
          ctx.fillText(seg.t, tx, y + st.F * 1.2 + st.F * 1.15);
          tx += ctx.measureText(seg.t).width;
        });
        ctx.font = sansFont(st.F * 0.98);
        ctx.fillStyle = st.pal.muted;
        ctx.fillText(sheet.sub, x, y + st.F * 1.2 + st.F * 2.3 + st.F * 0.6);
        ctx.fillStyle = st.pal.accent;
        ctx.fillRect(x, y + head.h - st.F * 0.35, st.F * 3, 3);
      },
    };
    items.push(head);
    sheet.blocks.forEach((block) => {
      const item = measureBlock(st, block, w, false);
      item.before = item.before ?? 0;
      item.after = block.k === "h" ? 0 : st.F * 0.5;
      items.push(item);
    });
    return { items, margin, width };
  }

  const makeCanvas = (w, h) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
  };

  // Draw items [from, to) onto a fresh canvas. footer: optional text at the bottom.
  function paintPage(layout, st, scale, list, height, footer) {
    const canvas = makeCanvas(layout.width * scale, height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = st.pal.bg;
    ctx.fillRect(0, 0, layout.width, height);
    let y = st.F * 1.4;
    list.forEach((item) => {
      y += item.before || 0;
      item.draw(ctx, layout.margin, y);
      y += item.h + (item.after || 0);
    });
    if (footer) {
      ctx.font = sansFont(st.F * 0.72);
      ctx.fillStyle = st.pal.muted;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(footer, layout.width / 2, height - st.F * 0.9);
    }
    return canvas;
  }

  const itemHeight = (item) => (item.before || 0) + item.h + (item.after || 0);

  // render(id, { width, font, scale, pal: "app" | "light", pageHeight }) -> { pages: [canvas], width, height }
  function render(id, opts = {}) {
    const sheet = SHEETS.find((s) => s.id === id) || SHEETS[0];
    const pal = opts.pal === "app" ? appPalette() : LIGHT;
    const st = style({ font: opts.font, pal });
    const width = opts.width || 800;
    const scale = opts.scale || 1;
    const layout = layoutSheet(sheet, width, st);
    const top = st.F * 1.4;
    const bottom = st.F * 1.4;
    if (!opts.pageHeight) {
      const height = top + layout.items.reduce((sum, item) => sum + itemHeight(item), 0) + bottom;
      return { pages: [paintPage(layout, st, scale, layout.items, height)], width, height };
    }
    const room = opts.pageHeight - top - bottom - st.F * 1.2;
    const groups = [[]];
    let used = 0;
    layout.items.forEach((item) => {
      const h = itemHeight(item);
      if (groups[groups.length - 1].length && used + h > room) { groups.push([]); used = 0; }
      groups[groups.length - 1].push(item);
      used += h;
    });
    const pages = groups.map((group, i) => paintPage(layout, st, scale, group, opts.pageHeight, `${sheet.title} · page ${i + 1} of ${groups.length}`));
    return { pages, width, height: opts.pageHeight };
  }

  // ---------------------------------------------------------------------------
  // The panel: a column beside the board (the board narrows to make room)
  // ---------------------------------------------------------------------------
  const KEY = "skybridge-help";
  const WIDTHS = [340, 460, 600];
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const keep = (state) => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

  let dock = null;
  let state = { sheet: SHEETS[0].id, width: 1 };
  let drawn = "";
  let observer = null;

  function build() {
    if (dock) return dock;
    const saved = read();
    state = { ...state, ...saved };
    if (saved.width === undefined && window.innerWidth < 900) state.width = 0; // portrait iPads: keep the board wide enough to write on
    dock = document.createElement("aside");
    dock.className = "help-dock";
    dock.id = "helpDock";
    dock.hidden = true;
    dock.setAttribute("aria-label", "Help sheets");
    dock.innerHTML = `
      <header class="hd-head">
        <strong>Help sheets</strong>
        <span class="hd-spacer"></span>
        <button type="button" class="tool hd-icon" data-act="width" aria-label="Make the panel wider or narrower" title="Wider or narrower"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h13M6.5 7l-3 3 3 3M13.5 7l3 3-3 3"/></svg></button>
        <button type="button" class="tool hd-icon" data-act="close" aria-label="Close help sheets" title="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
      </header>
      <nav class="hd-tabs" role="tablist" aria-label="Help sheets"></nav>
      <div class="hd-scroll"><canvas class="hd-canvas"></canvas></div>
      <footer class="hd-foot">
        <button type="button" class="tool" data-act="pin" title="Put this sheet on the page you're working on">Pin to page</button>
        <button type="button" class="tool" data-act="print" title="Print or save as a PDF">Print / PDF</button>
        <button type="button" class="tool" data-act="save" title="Save as a picture">Save image</button>
        <button type="button" class="tool" data-act="printAll" title="Print or save all the sheets as a PDF">All sheets</button>
      </footer>`;
    document.body.append(dock);
    const tabs = dock.querySelector(".hd-tabs");
    SHEETS.forEach((sheet) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.sheet = sheet.id;
      button.textContent = sheet.tab;
      tabs.append(button);
    });
    dock.addEventListener("click", onClick);
    observer = new ResizeObserver(() => draw());
    observer.observe(dock.querySelector(".hd-scroll"));
    return dock;
  }

  function dockWidth() {
    const wanted = WIDTHS[state.width] || WIDTHS[1];
    return Math.min(wanted, Math.round(window.innerWidth * 0.62));
  }

  function applyWidth() {
    document.documentElement.style.setProperty("--dock-w", `${dockWidth()}px`);
  }

  function draw(force) {
    if (!dock || dock.hidden) return;
    const holder = dock.querySelector(".hd-scroll");
    const width = Math.max(240, Math.floor(holder.clientWidth));
    const key = `${state.sheet}|${width}|${document.documentElement.dataset.paper || ""}|${document.documentElement.dataset.theme || ""}`;
    if (!force && key === drawn) return;
    drawn = key;
    const scale = Math.min(3, window.devicePixelRatio || 1);
    const font = width < 380 ? 14 : width < 520 ? 15 : 16;
    const out = render(state.sheet, { width, font, scale, pal: "app" });
    const target = dock.querySelector(".hd-canvas");
    target.width = out.pages[0].width;
    target.height = out.pages[0].height;
    target.style.width = `${width}px`;
    target.style.height = `${out.height}px`;
    target.getContext("2d").drawImage(out.pages[0], 0, 0);
    dock.querySelectorAll(".hd-tabs [role=tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.sheet === state.sheet)));
  }

  function show(id) {
    build();
    if (id && SHEETS.some((s) => s.id === id)) state.sheet = id;
    dock.hidden = false;
    document.documentElement.dataset.help = "on";
    applyWidth();
    keep(state);
    requestAnimationFrame(() => { draw(true); dock.querySelector(".hd-scroll").scrollTop = 0; });
    const button = document.getElementById("helpBtn");
    if (button) button.setAttribute("aria-pressed", "true");
  }

  function close() {
    if (!dock || dock.hidden) return;
    dock.hidden = true;
    delete document.documentElement.dataset.help;
    document.documentElement.style.removeProperty("--dock-w");
    const button = document.getElementById("helpBtn");
    if (button) button.setAttribute("aria-pressed", "false");
  }

  const isOpen = () => !!dock && !dock.hidden;
  const toast = (text) => { try { document.getElementById("toast") && root.SkybridgePad?.toast?.(text); } catch {} };

  const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture was too big to make."))), type, quality));

  async function pin() {
    const out = render(state.sheet, { width: 720, font: 16, scale: 2, pal: "app" });
    const blob = await blobOf(out.pages[0], "image/jpeg", 0.92);
    const file = new File([blob], `help-${state.sheet}.jpg`, { type: "image/jpeg" });
    if (!root.SkybridgePad?.addHelpSheet) return;
    await root.SkybridgePad.addHelpSheet(file);
  }

  async function saveImage() {
    const out = render(state.sheet, { width: 900, font: 17, scale: 2, pal: "light" });
    const blob = await blobOf(out.pages[0], "image/png");
    const file = new File([blob], `skybridge-help-${state.sheet}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Skybridge help sheet" }); return; } catch (error) { if (error?.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // The same print window pattern as the board's PDF export: pictures to print, one button.
  async function printSheets(ids) {
    const win = window.open("", "skybridge-help");
    if (!win) { toast("Allow pop-ups for this page, then try again."); return; }
    win.document.write("<!doctype html><title>Help sheets</title><body style='font:16px sans-serif;padding:24px'>Getting the sheets ready…</body>");
    const images = [];
    ids.forEach((id) => {
      const out = render(id, { width: 800, font: 16, scale: 2, pal: "light", pageHeight: Math.round(800 * 1.29) });
      out.pages.forEach((canvas, i) => images.push(`<img src="${canvas.toDataURL("image/png")}" alt="${id} page ${i + 1}">`));
    });
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Help sheets</title><style>
body{margin:0;padding:16px;font:16px -apple-system,sans-serif;background:#eee;color:#111}
img{display:block;width:100%;max-width:820px;height:auto;margin:0 auto 14px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.2)}
button{font:inherit;padding:10px 16px;margin:0 0 12px;border-radius:10px;border:1px solid #888;background:#f3f3f3}
@page{margin:8mm}@media print{body{background:#fff;padding:0}button{display:none}img{box-shadow:none;margin:0;max-width:none;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}}
</style></head><body><button onclick="print()">Print / Save as PDF</button>${images.join("")}</body></html>`);
    win.document.close();
    win.focus();
  }

  async function onClick(event) {
    const tab = event.target.closest("[data-sheet]");
    if (tab) { state.sheet = tab.dataset.sheet; keep(state); draw(true); dock.querySelector(".hd-scroll").scrollTop = 0; return; }
    const button = event.target.closest("[data-act]");
    if (!button) return;
    try {
      switch (button.dataset.act) {
        case "close": close(); break;
        case "width": state.width = (state.width + 1) % WIDTHS.length; keep(state); applyWidth(); break;
        case "pin": await pin(); break;
        case "save": await saveImage(); break;
        case "print": await printSheets([state.sheet]); break;
        case "printAll": await printSheets(SHEETS.map((s) => s.id)); break;
        default: break;
      }
    } catch (error) {
      toast(error?.message || "That didn't work.");
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => { if (isOpen()) { applyWidth(); draw(); } });
  }

  root.SkybridgeHelp = {
    sheets: SHEETS.map(({ id, tab, title }) => ({ id, tab, title })),
    examples: EX,
    content: SHEETS,
    render,
    open: show,
    close,
    toggle: () => (isOpen() ? close() : show()),
    isOpen,
  };
})();
