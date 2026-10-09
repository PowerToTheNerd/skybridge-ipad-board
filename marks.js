/*
 * Marks written on the board after Check my work: a hand-written "Correct!" beside finished work,
 * or a loose circle around the entry that is wrong. They are ordinary strokes (so Undo and the
 * eraser work on them), and a circle only shows where to look: it never says what the answer is.
 *
 * window.SkybridgeMarks = { correct(ink, view), circle(box), TEXT }
 *   ink: { x0, y0, x1, y1 } of the writing; view: { x0, y0, x1, y1 } of what is on screen.
 *   Each returns { strokes: [{ color, width, points }] } in board coordinates.
 */
(() => {
  const GOOD = "#34c38f";
  const BAD = "#ef5350";
  const TAU = Math.PI * 2;

  // A tiny pen: letters are lists of strokes in a box 1 tall (baseline at y = 1), each a list of [x, y].
  const arc = (cx, cy, rx, ry, from, to, steps = 18) => {
    const out = [];
    for (let i = 0; i <= steps; i += 1) {
      const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
      out.push([cx + rx * Math.cos(a), cy - ry * Math.sin(a)]);
    }
    return out;
  };
  const GLYPHS = {
    C: { w: 0.78, strokes: [arc(0.4, 0.5, 0.38, 0.5, 42, 322, 26)] },
    o: { w: 0.62, strokes: [arc(0.3, 0.68, 0.27, 0.32, 80, 450, 24)] },
    r: { w: 0.5, strokes: [[[0.06, 0.4], [0.06, 1]], [[0.06, 0.66], [0.14, 0.5], [0.28, 0.4], [0.44, 0.44]]] },
    e: { w: 0.64, strokes: [[[0.04, 0.7], [0.56, 0.7], ...arc(0.3, 0.68, 0.27, 0.32, 0, 318, 20).slice(1)]] },
    c: { w: 0.56, strokes: [arc(0.3, 0.68, 0.26, 0.32, 44, 320, 18)] },
    t: { w: 0.46, strokes: [[[0.26, 0.12], [0.26, 0.86], [0.32, 0.97], [0.44, 0.99]], [[0.04, 0.42], [0.46, 0.42]]] },
    "!": { w: 0.26, strokes: [[[0.1, 0.0], [0.1, 0.68]], arc(0.1, 0.93, 0.04, 0.045, 90, 450, 8)] },
  };
  const TEXT = "Correct!";

  // Slightly different every time, so it reads as written and not stamped.
  const jitter = (seed) => {
    let x = seed || 1;
    return () => {
      x = (x * 16807) % 2147483647;
      return x / 2147483647 - 0.5;
    };
  };

  function word(text, left, top, height) {
    const rand = jitter(Math.floor(left * 7 + top * 13) % 9973 + 11);
    const tilt = -0.05;
    const strokes = [];
    let pen = 0;
    for (const letter of text) {
      const glyph = GLYPHS[letter];
      if (!glyph) continue;
      const lift = rand() * 0.07 * height;
      for (const line of glyph.strokes) {
        strokes.push(line.map(([gx, gy]) => {
          const x = pen + gx * height;
          const y = gy * height + lift;
          // Rotate a little about the start of the word.
          return [left + x * Math.cos(tilt) - y * Math.sin(tilt) + rand() * 0.4, top + x * Math.sin(tilt) + y * Math.cos(tilt) + rand() * 0.4];
        }));
      }
      pen += (glyph.w + 0.1) * height;
    }
    return { strokes, width: pen };
  }

  const smooth = (line, per = 3) => {
    // Add points between the corners of a glyph so the stroke renderer curves them gently.
    const out = [];
    for (let i = 0; i < line.length - 1; i += 1) {
      for (let k = 0; k < per; k += 1) {
        const t = k / per;
        out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t]);
      }
    }
    out.push(line[line.length - 1]);
    return out;
  };

  const pressured = (line, base = 0.55) => line.map(([x, y], i) => {
    const edge = Math.min(i, line.length - 1 - i) / Math.max(1, Math.min(6, line.length / 3));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round((base * (0.7 + 0.3 * Math.min(1, edge))) * 1000) / 1000];
  });

  // "Correct!" with a tick, to the right of the work when there is room on screen, else beneath it.
  function correct(ink, view) {
    const inkH = Math.max(1, ink.y1 - ink.y0);
    const height = Math.min(84, Math.max(46, inkH * 0.45));
    const measure = word(TEXT, 0, 0, height).width;
    const tickW = height * 0.9;
    const total = tickW + height * 0.3 + measure;
    let left = ink.x1 + 44;
    let top = (ink.y0 + ink.y1) / 2 - height / 2;
    if (view && left + total > view.x1 - 16) {
      left = ink.x0;
      top = ink.y1 + 36;
      if (top + height > view.y1 - 16) top = Math.max(ink.y0, view.y1 - height - 16);
    }
    const tick = [[0, 0.58], [0.3, 0.92], [0.96, 0.05]].map(([x, y]) => [left + x * tickW, top + y * height]);
    const text = word(TEXT, left + tickW + height * 0.3, top, height);
    const lines = [tick, ...text.strokes];
    return {
      strokes: lines.map((line, i) => ({
        color: GOOD,
        width: i === 0 ? 4 : 3.2,
        points: pressured(smooth(line, 3)),
      })),
    };
  }

  // A loose, slightly spiralling ring around a box [x0, y0, x1, y1], the way a pen circles something twice over.
  function circle(box) {
    const [x0, y0, x1, y1] = box;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.max(38, (x1 - x0) / 2 + 20);
    const ry = Math.max(30, (y1 - y0) / 2 + 16);
    const rand = jitter(Math.floor(cx * 3 + cy * 5) % 9973 + 7);
    const phase = rand() * 2;
    const points = [];
    const steps = 64;
    const start = Math.PI * 0.9;
    const sweep = TAU + 0.55;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const a = start + sweep * t;
      const grow = 1 + 0.07 * t + 0.035 * Math.sin(a * 2 + phase);
      points.push([cx + rx * grow * Math.cos(a) * 1.04, cy - ry * grow * Math.sin(a)]);
    }
    return { strokes: [{ color: BAD, width: 3.4, points: pressured(points, 0.6) }] };
  }

  // Square brackets standing just outside a box [x0, y0, x1, y1]: a matrix's own lines.
  // { left, right } say which sides to draw (one may already be there).
  function brackets(box, sides = {}) {
    const [x0, y0, x1, y1] = box;
    const h = y1 - y0;
    const gap = Math.max(14, Math.min(34, h * 0.14));
    const lift = Math.max(8, Math.min(22, h * 0.07));
    const arm = Math.max(10, Math.min(26, h * 0.13));
    const top = y0 - lift;
    const bottom = y1 + lift;
    const lines = [];
    if (sides.left !== false) {
      const x = x0 - gap;
      lines.push([[x + arm, top], [x, top], [x, bottom], [x + arm, bottom]]);
    }
    if (sides.right !== false) {
      const x = x1 + gap;
      lines.push([[x - arm, top], [x, top], [x, bottom], [x - arm, bottom]]);
    }
    return { strokes: lines.map((line) => ({ points: pressured(smooth(line, 6), 0.6) })), gap };
  }

  window.SkybridgeMarks = { correct, circle, brackets, TEXT };
})();
