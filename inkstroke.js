/* Pen strokes that look like Excalidraw's freedraw: perfect-freehand turns the
 * points into a filled outline that thins and swells with speed and, from an
 * Apple Pencil, with pressure. Shared by My board (myboard.js) and the iPad
 * page (ipad-board/pad.js) so both draw the same stroke the same way.
 * Points are [x, y] or [x, y, pressure].
 *
 * Holding the pen still at the end of a stroke snaps it to a clean shape, like
 * iPad Notes: a straight line, or a matrix bracket [ ] ( ) sized to the stroke.
 * Pen colours: PALETTE lists the extra colours, and colorOn(color, paper) keeps one readable on a
 * paper, whatever the paper (a dark pen on dark paper is lifted, a light one on light paper darkened).
 * A highlighter stroke (stroke.hl) is wide and see-through, and layered() puts it under the ink.
 * A quick zigzag over ink is a scribble: scribble() spots one, and crossed() lists what it crosses.
 * Exposes window.SkybridgeInk = { fill, snap, hold, PALETTE, colorOn, paperOf, isHex, layered, scribble, crossed, inside }.
 */
(() => {
  "use strict";

  // Excalidraw's freedraw settings (size there is strokeWidth * 4.25).
  const OPTIONS = {
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
  };
  // The Smoothing setting (0 to 100) steers how much perfect-freehand evens out the line. 50 is Excalidraw's
  // own feel; the default is clearly smoother. Both boards on a page share it (setSmoothing).
  const DEFAULT_SMOOTHING = 80;
  let smoothing = DEFAULT_SMOOTHING;
  function setSmoothing(value) {
    const number = Number(value);
    smoothing = Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : DEFAULT_SMOOTHING;
  }
  function smoothOptions() {
    // 0 follows the hand closely; 100 is silky. 50 is Excalidraw's own setting.
    const amount = 0.15 + 0.75 * (smoothing / 100);
    return { streamline: amount, smoothing: amount };
  }
  const SIZE_PER_WIDTH = 1.7; // our 2.6 px pen ≈ Excalidraw's thin pen
  // Snapped shapes: even width and crisp corners instead of the hand-drawn swell.
  const CLEAN_OPTIONS = { thinning: 0, streamline: 0, smoothing: 0.2 };

  const HOLD_MS = 450;
  const HOLD_SLOP = 5; // px the pen may wobble while held still

  // Fill the outline with quadratic curves through its midpoints, as Excalidraw does.
  function tracePath(target, outline) {
    const count = outline.length;
    if (count < 3) return false;
    target.beginPath();
    target.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < count; i += 1) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % count];
      target.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    target.closePath();
    return true;
  }

  // The easing perfect-freehand applies to the pressure of a stroke's thickness.
  const ease = OPTIONS.easing;
  const thickness = (pressure) => ease(0.5 - OPTIONS.thinning * (0.5 - pressure));

  // Draws one pen stroke filled in the current fillStyle. stroke: { points, width, sim, done }.
  // sim (no real pressure, as with a mouse) lets perfect-freehand fake pressure from speed.
  function fill(target, stroke, scale = 1) {
    if (stroke.hl) return marker(target, stroke, scale);
    const freehand = window.PerfectFreehand;
    if (!freehand) return false;
    const points = scale === 1
      ? stroke.points
      : stroke.points.map(([x, y, p]) => (p === undefined ? [x * scale, y * scale] : [x * scale, y * scale, p]));
    // A snapped line or bracket is drawn evenly, but as thick as the handwriting it replaced:
    // snap() leaves that stroke's mean pressure on its points.
    let gain = 1;
    if (stroke.clean && stroke.points[0]?.[2] !== undefined) gain = thickness(stroke.points[0][2]) / thickness(0.5);
    const outline = freehand.getStroke(points, {
      ...OPTIONS,
      ...smoothOptions(),
      ...(stroke.clean ? CLEAN_OPTIONS : null),
      size: stroke.width * SIZE_PER_WIDTH * scale * gain,
      simulatePressure: stroke.sim !== false,
      last: stroke.done !== false,
    });
    if (!tracePath(target, outline)) return false;
    target.fill();
    return true;
  }

  // A highlighter: an even, see-through band. One path stroked once, so it never darkens where it crosses itself.
  const MARKER_ALPHA = 0.38;
  function marker(target, stroke, scale) {
    const points = stroke.points;
    target.globalAlpha *= MARKER_ALPHA;
    target.lineCap = "butt";
    target.lineJoin = "round";
    target.lineWidth = stroke.width * scale;
    if (points.length === 1) {
      target.fillRect(points[0][0] * scale - stroke.width * scale / 2, points[0][1] * scale - stroke.width * scale / 2, stroke.width * scale, stroke.width * scale);
      return true;
    }
    target.beginPath();
    target.moveTo(points[0][0] * scale, points[0][1] * scale);
    for (let i = 1; i < points.length - 1; i += 1) {
      const [x, y] = points[i];
      const [nx, ny] = points[i + 1];
      target.quadraticCurveTo(x * scale, y * scale, ((x + nx) / 2) * scale, ((y + ny) / 2) * scale);
    }
    const last = points[points.length - 1];
    target.lineTo(last[0] * scale, last[1] * scale);
    target.stroke();
    return true;
  }

  // A light tidy for a finished stroke: two passes of a 1-2-1 average over the points in between,
  // so wobble from the hand softens while the ends and the pressure stay put.
  function tidy(points) {
    if (!points || points.length < 8) return points;
    let list = points;
    for (let pass = 0; pass < 2; pass += 1) {
      const from = list;
      list = from.map((point, i) => {
        if (i === 0 || i === from.length - 1) return point;
        const [a, b] = [from[i - 1], from[i + 1]];
        const x = Math.round((a[0] * 0.25 + point[0] * 0.5 + b[0] * 0.25) * 10) / 10;
        const y = Math.round((a[1] * 0.25 + point[1] * 0.5 + b[1] * 0.25) * 10) / 10;
        return point.length > 2 ? [x, y, point[2]] : [x, y];
      });
    }
    return list;
  }

  // Highlighters first, so they sit under the ink whenever they were drawn.
  const layered = (list) => [...list.filter((stroke) => stroke.hl), ...list.filter((stroke) => !stroke.hl)];

  // ---------------------------------------------------------------------------
  // Shape snapping
  // ---------------------------------------------------------------------------
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // Evenly spaced points along a polyline, so the clean pen draws an even width.
  function densify(corners, step = 3) {
    const out = [[corners[0][0], corners[0][1]]];
    for (let i = 1; i < corners.length; i += 1) {
      const [ax, ay] = corners[i - 1];
      const [bx, by] = corners[i];
      const n = Math.max(1, Math.ceil(dist(corners[i - 1], corners[i]) / step));
      for (let k = 1; k <= n; k += 1) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  function distanceToLine(p, a, b) {
    const length = dist(a, b);
    if (!length) return dist(p, a);
    return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length;
  }

  // Length along the stroke, sampled every 10 px so hand tremor doesn't count as distance.
  function pathLength(points) {
    let total = 0;
    let last = points[0];
    for (const point of points) {
      const step = dist(last, point);
      if (step < 10) continue;
      total += step;
      last = point;
    }
    return total + dist(last, points[points.length - 1]);
  }

  function snapLine(points) {
    const a = points[0];
    let b = points[points.length - 1];
    const length = dist(a, b);
    if (length < 16) return null;
    const wobble = Math.max(...points.map((p) => distanceToLine(p, a, b)));
    if (wobble > Math.max(5, length * 0.07) || pathLength(points) > length * 1.25) return null;
    // Nearly level or upright lines snap to exactly level or upright.
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nearest = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(angle - nearest) < (8 * Math.PI) / 180) {
      b = [a[0] + Math.cos(nearest) * length, a[1] + Math.sin(nearest) * length];
    }
    return densify([a, b]);
  }

  // A tall stroke whose two ends sit at its top and bottom, open to one side: [ ] ( ).
  function snapBracket(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const width = right - left;
    const height = bottom - top;
    if (height < 24 || width < 3 || width > height * 0.6) return null;
    const start = points[0];
    const end = points[points.length - 1];
    const near = height * 0.22;
    const startsTop = start[1] - top < near && bottom - end[1] < near;
    const startsBottom = bottom - start[1] < near && end[1] - top < near;
    if (!startsTop && !startsBottom) return null;
    // The spine is the side the ends point away from.
    const endsX = (start[0] + end[0]) / 2;
    const opensRight = endsX > (left + right) / 2;
    const spine = opensRight ? left : right;
    const side = opensRight ? 1 : -1;
    if (Math.abs(endsX - spine) < width * 0.5) return null;

    // Square if the middle hugs the spine; round if it bows away from it.
    const middle = points.filter((p) => p[1] > top + height * 0.25 && p[1] < bottom - height * 0.25);
    if (!middle.length) return null;
    const drift = Math.max(...middle.map((p) => Math.abs(p[0] - spine)));
    let shape;
    if (drift < Math.max(4, width * 0.3)) {
      const arm = Math.min(Math.max(width, height * 0.12), height * 0.35);
      shape = densify([[spine + side * arm, top], [spine, top], [spine, bottom], [spine + side * arm, bottom]]);
    } else {
      const depth = Math.min(Math.max(width, height * 0.1), height * 0.3);
      const ends = spine + side * depth;
      // Quadratic through both ends that touches the spine halfway down.
      const mid = (top + bottom) / 2;
      const control = [2 * spine - ends, mid];
      const corners = [];
      for (let i = 0; i <= 32; i += 1) {
        const t = i / 32;
        const u = 1 - t;
        corners.push([u * u * ends + 2 * u * t * control[0] + t * t * ends, u * u * top + 2 * u * t * control[1] + t * t * bottom]);
      }
      shape = densify(corners);
    }
    return startsBottom ? shape.reverse() : shape;
  }

  // Returns clean points for a recognised shape, or null to leave the stroke as drawn.
  function snap(points) {
    if (!points || points.length < 4) return null;
    const shape = snapLine(points) || snapBracket(points);
    if (!shape) return null;
    // Keep the pen's feel: the stroke's mean pressure, so the shape is as thick as the writing.
    const pressures = points.map((point) => point[2]).filter((value) => value !== undefined);
    if (!pressures.length) return shape;
    const mean = Math.round((pressures.reduce((sum, value) => sum + value, 0) / pressures.length) * 1000) / 1000;
    return shape.map(([x, y]) => [x, y, mean]);
  }

  // ---------------------------------------------------------------------------
  // Pen colours
  // ---------------------------------------------------------------------------
  // The first four pens (ink and three marks) follow the paper; these are fixed colours.
  const PALETTE = [
    { color: "#1e1e1e", label: "Black" },
    { color: "#6b7280", label: "Dark grey" },
    { color: "#d03a30", label: "Red" },
    { color: "#e8710a", label: "Orange" },
    { color: "#2f9e44", label: "Green" },
    { color: "#0c8f8f", label: "Teal" },
    { color: "#2b6fd6", label: "Blue" },
    { color: "#8a4fd0", label: "Purple" },
    { color: "#e0508f", label: "Pink" },
    { color: "#8b5a2b", label: "Brown" },
  ];

  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value || "");

  function parseColor(text) {
    const value = String(text || "").trim();
    if (isHex(value)) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    const rgb = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  }

  function luminance([r, g, b]) {
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  function toHsl([r, g, b]) {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return [h * 60, s, l];
  }

  function fromHsl([h, s, l]) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }

  // The colour a node is drawn on: its own background, or the nearest ancestor's that has one.
  function paperOf(node) {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      const background = getComputedStyle(current).backgroundColor;
      if (parseColor(background) && !/,\s*0\)$/.test(background) && background !== "transparent") return background;
    }
    return "#0d1613";
  }

  // A fixed colour, nudged lighter or darker only as far as needed to read on the paper (3:1).
  function colorOn(color, paper) {
    const ink = parseColor(color);
    const ground = parseColor(paper);
    if (!ink || !ground || contrast(ink, ground) >= 3) return color;
    const [h, s, l] = toHsl(ink);
    const lighten = luminance(ground) < 0.4;
    for (let step = 1; step <= 40; step += 1) {
      const next = fromHsl([h, s, Math.min(1, Math.max(0, l + (lighten ? 1 : -1) * step * 0.02))]);
      if (contrast(next, ground) >= 3) return `rgb(${next.join(",")})`;
    }
    return color;
  }

  // Calls onHold when the pen stays put for HOLD_MS mid-stroke. move(point) on every
  // sample, stop() when the stroke ends.
  function hold(onHold) {
    let anchor = null;
    let timer = 0;
    return {
      move(point) {
        if (anchor && dist(anchor, point) <= HOLD_SLOP) return;
        anchor = point;
        clearTimeout(timer);
        timer = setTimeout(onHold, HOLD_MS);
      },
      stop() {
        clearTimeout(timer);
        anchor = null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Scribble to erase, and lasso hit-testing
  // ---------------------------------------------------------------------------
  // Walks the path in steps of `step` px, so spacing doesn't depend on how fast the pen moved.
  function resample(points, step) {
    const out = [[points[0][0], points[0][1]]];
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
      let [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      let length = Math.hypot(bx - ax, by - ay);
      while (carry + length >= step) {
        const t = (step - carry) / length;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push([ax, ay]);
        length = Math.hypot(bx - ax, by - ay);
        carry = 0;
      }
      carry += length;
    }
    return out;
  }

  // A scribble reverses direction sharply, over and over, in a small area: at least three
  // back-and-forths (six hard turns) and a path several times longer than the scribble is wide.
  // Handwriting turns are rounder and travel on, so it doesn't count.
  function scribble(points) {
    if (!points || points.length < 12) return false;
    const path = resample(points, 6);
    if (path.length < 12) return false;
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (diag < 24 || path.length * 6 < diag * 3.2) return false;
    let turns = 0;
    let last = -10;
    for (let i = 2; i < path.length; i += 1) {
      const ax = path[i - 1][0] - path[i - 2][0];
      const ay = path[i - 1][1] - path[i - 2][1];
      const bx = path[i][0] - path[i - 1][0];
      const by = path[i][1] - path[i - 1][1];
      const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
      // 110 degrees or more in one 6 px step, and not just the same turn counted twice.
      if (cos < -0.34 && i - last > 1) { turns += 1; last = i; }
    }
    return turns >= 6;
  }

  function segmentDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  const bounds = (points, pad = 0) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of points) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };

  // The strokes in `list` that the path touches. Eraser strokes and the path's own stroke don't count.
  function crossed(path, list, skip) {
    const line = resample(path, 5);
    const box = bounds(line, 4);
    return list.filter((stroke) => {
      if (stroke === skip || stroke.eraser || !stroke.points.length) return false;
      const reach = Math.max(3, stroke.width / 2 + 1);
      const mine = bounds(stroke.points, reach);
      if (mine[0] > box[2] || mine[2] < box[0] || mine[1] > box[3] || mine[3] < box[1]) return false;
      const dense = resample(stroke.points.length > 1 ? stroke.points : [stroke.points[0], stroke.points[0]], 4);
      return dense.some((point) => {
        for (let i = 1; i < line.length; i += 1) if (segmentDistance(point, line[i - 1], line[i]) <= reach) return true;
        return false;
      });
    });
  }

  // Even-odd test: is the point inside the polygon?
  function inside(point, polygon) {
    let on = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) on = !on;
    }
    return on;
  }

  window.SkybridgeInk = { fill, snap, hold, PALETTE, colorOn, paperOf, isHex, layered, scribble, crossed, inside, bounds, setSmoothing, tidy, DEFAULT_SMOOTHING };
})();
