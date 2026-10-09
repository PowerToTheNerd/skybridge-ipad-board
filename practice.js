/*
 * Practice problems: pick a topic, and Gemini (with your own key) writes one problem for it. It goes on
 * the current page as a problem card, or into a new notebook. It never gives the answer: Check my work
 * grades what you write, with the exact checker.
 *
 * Problems are made to suit that checker: whole numbers or simple fractions, small matrices, and the
 * matrix really is invertible (or has an LU with no row swaps) when the topic needs that. A problem
 * that does not check out is thrown away and another is asked for.
 *
 * window.SkybridgePractice = { TOPICS, make(topicId, { avoid }) -> { ok, problem | error }, items(problem), problemText(problem) }
 */
(() => {
  const AI = window.SkybridgeAI;
  const MathCheck = window.SkybridgeMath;

  // need: "invertible" (det is not 0), "lu" (every leading minor is not 0, so no row swaps), or "any".
  const TOPICS = [
    { id: "add", label: "Matrix addition", need: "any", brief: "adding or subtracting two matrices of the same size, possibly with a scalar multiple (like 2A - B)" },
    { id: "multiply", label: "Matrix multiplication", need: "any", brief: "multiplying two matrices (sizes that match, such as 2x3 times 3x2 or 3x3 times 3x3)" },
    { id: "rref", label: "Row reduction", need: "any", brief: "reducing a matrix to reduced row echelon form by row operations (3x3 or 3x4, with at least one pivot that is not 1)" },
    { id: "lu", label: "LU decomposition", need: "lu", brief: "finding the LU decomposition of a 3x3 matrix (no row swaps needed, so L and U exist)" },
    { id: "inverse", label: "Inverses", need: "invertible", brief: "finding the inverse of an invertible 2x2 or 3x3 matrix by row reducing [A | I]" },
    { id: "det", label: "Determinants", need: "any", brief: "finding the determinant of a 3x3 or 4x4 matrix, using row operations or cofactor expansion" },
    { id: "elementary", label: "Elementary matrices", need: "invertible", brief: "writing a matrix as a product of elementary matrices, or finding the elementary matrix for a given row operation (3x3)" },
    { id: "system", label: "Linear systems", need: "any", brief: "solving a system of 3 linear equations in 3 unknowns by row reduction (give it as an augmented matrix)" },
    { id: "random", label: "Random", need: "any", brief: "any one linear algebra problem about matrices (pick the type at random)" },
  ];

  const STR = { type: "STRING" };
  const SCHEMA = {
    type: "OBJECT",
    properties: { title: STR, text: STR, lines: { type: "ARRAY", items: STR } },
    required: ["title", "text", "lines"],
  };

  const promptFor = (topic, avoid) => `You write ONE practice problem for a student studying linear algebra. Topic: ${topic.brief}.
Answer with JSON only: {"title": "...", "text": "...", "lines": ["..."]}
- title: the topic name, at most 28 characters.
- text: the instruction, one or two short sentences, like "Find the LU decomposition of A."
- lines: the given matrices or equations, each as LaTeX on its own line. Write a matrix like
  "A = \\\\begin{bmatrix} 2 & 1 \\\\\\\\ 4 & 3 \\\\end{bmatrix}" (rows separated by \\\\\\\\, entries by &).
Rules: use whole numbers (small, like -5 to 9) or simple fractions only. Make it solvable by hand with one
exact answer. NEVER include the answer, any steps, any hint, or the word "solution".
Variety: ${Math.floor(Math.random() * 1e6)}.${avoid?.length ? ` Do not repeat these earlier problems: ${avoid.slice(-4).join(" | ")}.` : ""}`;

  // The matrices written in a problem's lines, as rows of numbers (null if any is not exact numbers).
  function matricesOf(lines) {
    const found = [];
    for (const line of lines) {
      for (const match of String(line).matchAll(/\\begin\{[pbvBV]?matrix\}([\s\S]*?)\\end\{[pbvBV]?matrix\}/g)) {
        try {
          found.push(MathCheck.parseMatrix ? MathCheck.parseMatrix(match[1]) : null);
        } catch {
          return null;
        }
      }
    }
    return found.length ? found : null;
  }

  const asText = (matrix) => MathCheck.fmtMatrix(matrix);

  // Does the problem suit the checker? Returns "" when it does, else why not.
  function trouble(topic, problem) {
    if (!problem.title || !problem.text || !problem.lines.length) return "incomplete";
    if (/\b(solution|answer|hint)s?\b/i.test(`${problem.text} ${problem.lines.join(" ")}`)) return "gives the answer away";
    const matrices = matricesOf(problem.lines);
    if (!matrices) return "no readable matrix";
    if (matrices.some((m) => m.length > 4 || m[0].length > 5)) return "too big";
    const first = matrices[0];
    if (topic.need === "any") return "";
    if (first.length !== first[0].length) return "not square";
    const det = (m) => { try { return MathCheck.run({ operation: "determinant", matrix: asText(m) }); } catch { return null; } };
    const whole = det(first);
    if (!whole || whole.invertible !== true) return "not invertible";
    if (topic.need === "lu") {
      for (let k = 1; k < first.length; k += 1) {
        const minor = det(first.slice(0, k).map((row) => row.slice(0, k)));
        if (!minor || minor.invertible !== true) return "needs a row swap";
      }
    }
    return "";
  }

  async function make(topicId, { avoid = [] } = {}) {
    const topic = TOPICS.find((t) => t.id === topicId) || TOPICS[TOPICS.length - 1];
    if (!AI?.hasKey()) return { ok: false, error: "To make practice problems, add your free Gemini key under Notebooks, then Smart features." };
    if (navigator.onLine === false) return { ok: false, error: "No connection. Practice problems need the internet." };
    let why = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { data } = await AI.ask(promptFor(topic, avoid), SCHEMA);
        const lines = (Array.isArray(data.lines) ? data.lines : [data.lines]).map((line) => String(line ?? "").trim()).filter(Boolean).slice(0, 6);
        const problem = {
          topic: topic.id,
          title: String(data.title || topic.label).split(/\s+/).join(" ").slice(0, 40) || topic.label,
          text: String(data.text || "").trim().slice(0, 300),
          lines,
        };
        why = trouble(topic, problem);
        if (!why) return { ok: true, problem };
      } catch (error) {
        return { ok: false, error: AI.explain(error) };
      }
    }
    return { ok: false, error: `Gemini's problem didn't check out (${why}). Try again.` };
  }

  // The packet the problem card draws (the same card Gemini uses on My board).
  const items = (problem) => [
    { kind: "text", text: problem.text },
    ...problem.lines.map((line) => ({ kind: "math", latex: line })),
  ];

  const problemText = (problem) => (problem ? [problem.title, problem.text, ...problem.lines].join(". ") : "");

  window.SkybridgePractice = { TOPICS, make, items, problemText, trouble };
})();
