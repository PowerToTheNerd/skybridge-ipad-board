/* Pen strokes that look like Excalidraw's freedraw: perfect-freehand turns the
 * points into a filled outline that thins and swells with speed and, from an
 * Apple Pencil, with pressure. Shared by My board (myboard.js) and the iPad
 * page (ipad-board/pad.js) so both draw the same stroke the same way.
 * Points are [x, y] or [x, y, pressure].
 *
 * Holding the pen still at the end of a stroke snaps it to a clean shape, like
 * iPad Notes: a straight line, a matrix bracket [ ] ( ) sized to the stroke, a circle or ellipse, a rectangle or
 * square, a triangle, or an arrow. snapKind() says which one it found; the lasso's Shapes and the page's Tidy shapes use it too.
 * Pen colours: PALETTE lists the extra colours, and colorOn(color, paper) keeps one readable on a
 * paper, whatever the paper (a dark pen on dark paper is lifted, a light one on light paper darkened).
 * A highlighter stroke (stroke.hl) is wide and see-through, and layered() puts it under the ink.
 * A quick zigzag over ink is a scribble: scribble() spots one, and crossed() lists what it crosses.
 * Pen types: stroke.nib picks the nib (see NIBS: fountain, ballpoint, pencil, brush, calligraphy). A stroke with no nib,
 * or one this file doesn't know, is the ordinary pen, so older notebooks and older boards draw as they always did.
 * Exposes window.SkybridgeInk = { fill, snap, snapKind, hold, PALETTE, colorOn, penColorOn, paperOf, isHex, layered, scribble, crossed, inside, NIBS }.
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

  // The pen types. `size` scales the stroke's width, `thinning` is how much pressure/speed changes it, and
  // `start`/`end` are tapers in multiples of the width. The ordinary pen is the absence of a nib.
  const NIBS = {
    fountain: { label: "Fountain pen", size: 1.9, thinning: 0.8, start: 2, end: 6 },
    ballpoint: { label: "Ballpoint", size: 0.95, thinning: 0.1 },
    pencil: { label: "Pencil", size: 1.5, thinning: 0.35, grain: true },
    brush: { label: "Brush pen", size: 3, thinning: 0.9, start: 5, end: 10 },
    calligraphy: { label: "Calligraphy", size: 2.2, chisel: true },
  };
  const nibOf = (stroke) => (stroke.nib && Object.prototype.hasOwnProperty.call(NIBS, stroke.nib) ? NIBS[stroke.nib] : null);

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
  // A finished stroke's outline is worked out once and kept as a Path2D, so redrawing the page (every pan or
  // zoom frame) only fills it. The key notices a stroke that was moved, resized, snapped or re-styled.
  const outlines = typeof Path2D === "function" && typeof WeakMap === "function" ? new WeakMap() : null;
  function outlineKey(stroke) {
    const pts = stroke.points;
    const mid = pts[pts.length >> 1];
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${pts.length}|${first[0]},${first[1]}|${mid[0]},${mid[1]}|${last[0]},${last[1]}|${stroke.width}|${stroke.clean ? 1 : 0}|${stroke.sim === false ? 0 : 1}|${smoothing}|${stroke.nib || ""}`;
  }
  function cachedPath(stroke, points, freehand) {
    const key = outlineKey(stroke);
    const hit = outlines.get(stroke);
    if (hit && hit.points === stroke.points && hit.key === key) return hit.path;
    const nib = nibOf(stroke);
    let path = null;
    if (nib?.chisel) {
      path = new Path2D();
      if (!chiselPath(path, points, stroke.width, 1)) path = null;
    } else {
      const outline = freehand.getStroke(points, outlineOptions(stroke, 1));
      if (outline.length >= 3) {
        path = new Path2D();
        path.moveTo(outline[0][0], outline[0][1]);
        for (let i = 0; i < outline.length; i += 1) {
          const [x0, y0] = outline[i];
          const [x1, y1] = outline[(i + 1) % outline.length];
          path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        path.closePath();
      }
    }
    if (!path) return null;
    outlines.set(stroke, { points: stroke.points, key, path });
    return path;
  }

  // A broad-edge nib held at a fixed angle: thick across the nib, hairline along it. Every step of the stroke
  // sweeps the nib's edge into a four-sided piece, all wound the same way so the pieces add up instead of cancelling.
  const CHISEL_ANGLE = (40 * Math.PI) / 180;
  function chiselPath(path, points, width, scale) {
    const half = (width * 2.2 * scale) / 2;
    const dx = Math.cos(CHISEL_ANGLE) * half;
    const dy = -Math.sin(CHISEL_ANGLE) * half;
    const edge = (px, py) => [px + dx, py + dy, px - dx, py - dy];
    if (points.length === 1) {
      const [px, py] = [points[0][0] * scale, points[0][1] * scale];
      path.moveTo(px + dx, py + dy);
      path.lineTo(px - dy * 0.3, py + dx * 0.3);
      path.lineTo(px - dx, py - dy);
      path.lineTo(px + dy * 0.3, py - dx * 0.3);
      path.closePath();
      return true;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, ay, bx, by] = [points[i][0] * scale, points[i][1] * scale, points[i + 1][0] * scale, points[i + 1][1] * scale];
      const [a1x, a1y, a2x, a2y] = edge(ax, ay);
      const [b1x, b1y, b2x, b2y] = edge(bx, by);
      const turn = (b1x - a1x) * (a2y - a1y) - (b1y - a1y) * (a2x - a1x);
      path.moveTo(a1x, a1y);
      if (turn >= 0) { path.lineTo(b1x, b1y); path.lineTo(b2x, b2y); path.lineTo(a2x, a2y); }
      else { path.lineTo(a2x, a2y); path.lineTo(b2x, b2y); path.lineTo(b1x, b1y); }
      path.closePath();
    }
    return true;
  }

  // Pencil lead: the stroke is filled with a speckled tile in the pen's colour instead of a solid one. One tile per colour.
  const grainTiles = new Map();
  function grainTile(color) {
    let tile = grainTiles.get(color);
    if (tile) return tile;
    const size = 96;
    const noise = document.createElement("canvas");
    noise.width = noise.height = size;
    const nctx = noise.getContext("2d");
    const image = nctx.createImageData(size, size);
    let seed = 1234567;
    for (let i = 0; i < size * size; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const v = seed / 4294967296;
      image.data[i * 4 + 3] = v < 0.28 ? 0 : Math.round(150 + v * 105);
    }
    nctx.putImageData(image, 0, 0);
    tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const tctx = tile.getContext("2d");
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, size, size);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(noise, 0, 0);
    if (grainTiles.size > 48) grainTiles.clear();
    grainTiles.set(color, tile);
    return tile;
  }
  function grainFill(target) {
    const color = typeof target.fillStyle === "string" ? target.fillStyle : "#000";
    const pattern = target.createPattern?.(grainTile(color), "repeat");
    if (pattern) target.fillStyle = pattern;
  }
  function outlineOptions(stroke, scale) {
    // A snapped line or bracket is drawn evenly, at the pen's own width setting, so every straight line is the
    // same thickness whatever pressure the hand happened to use (even lines saved with a pressure on them).
    const nib = nibOf(stroke);
    const taper = (steps) => (steps && !stroke.clean ? { taper: stroke.width * steps * scale, cap: true } : { taper: 0, cap: true });
    return {
      ...OPTIONS,
      ...smoothOptions(),
      ...(nib && nib.thinning !== undefined ? { thinning: nib.thinning } : null),
      ...(nib ? { start: taper(nib.start), end: taper(nib.end) } : null),
      ...(stroke.clean ? CLEAN_OPTIONS : null),
      size: stroke.width * SIZE_PER_WIDTH * (nib?.size || 1) * scale,
      simulatePressure: stroke.sim !== false,
      last: stroke.done !== false,
    };
  }

  function fill(target, stroke, scale = 1) {
    if (stroke.hl) return marker(target, stroke, scale);
    const freehand = window.PerfectFreehand;
    if (!freehand) return false;
    const nib = nibOf(stroke);
    if (nib?.grain) grainFill(target);
    if (outlines && scale === 1 && stroke.done !== false && stroke.points.length >= 1) {
      const path = cachedPath(stroke, stroke.points, freehand);
      if (!path) return false;
      target.fill(path);
      return true;
    }
    const points = scale === 1
      ? stroke.points
      : stroke.points.map(([x, y, p]) => (p === undefined ? [x * scale, y * scale] : [x * scale, y * scale, p]));
    if (nib?.chisel) {
      const path = new Path2D();
      chiselPath(path, stroke.points, stroke.width, scale);
      target.fill(path);
      return true;
    }
    const outline = freehand.getStroke(points, outlineOptions(stroke, scale));
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

  // Douglas-Peucker: the corners of a hand-drawn polyline.
  function simplifyPath(points, tol) {
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [from, to] = stack.pop();
      let far = -1;
      let farDist = tol;
      for (let i = from + 1; i < to; i += 1) {
        const d = distanceToLine(points[i], points[from], points[to]);
        if (d > farDist) { farDist = d; far = i; }
      }
      if (far > 0) {
        keep[far] = true;
        stack.push([from, far], [far, to]);
      }
    }
    return points.filter((point, i) => keep[i]);
  }

  // How far the direction changes at b, in degrees (0 = straight on, 180 = doubled back).
  function turnAngle(a, b, c) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
  }

  const rotate = (dx, dy, angle) => [dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)];
  const LEVEL = (8 * Math.PI) / 180; // a shape this close to level or upright is made exactly so

  // The corners of a closed stroke, in order, with the seam where the pen started and stopped smoothed away.
  function cornersOf(path, diag) {
    let far = 0;
    for (let i = 1; i < path.length; i += 1) if (dist(path[0], path[i]) > dist(path[0], path[far])) far = i;
    if (far < 2 || far > path.length - 3) return null;
    const ring = [...simplifyPath(path.slice(0, far + 1), diag * 0.05), ...simplifyPath(path.slice(far), diag * 0.05).slice(1)];
    if (dist(ring[0], ring[ring.length - 1]) < diag * 0.25) ring.pop();
    let changed = true;
    while (changed && ring.length > 3) {
      changed = false;
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[(i + ring.length - 1) % ring.length];
        const b = ring[i];
        const c = ring[(i + 1) % ring.length];
        if (turnAngle(a, b, c) < 28 || dist(b, c) < diag * 0.1) {
          ring.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return ring;
  }

  // Closed outline from corner points, ending where it began.
  const closedFrom = (corners) => densify([...corners, corners[0]]);

  function snapRectangle(ring) {
    if (ring.length !== 4) return null;
    const sides = ring.map((p, i) => dist(p, ring[(i + 1) % 4]));
    for (let i = 0; i < 4; i += 1) {
      const turn = turnAngle(ring[(i + 3) % 4], ring[i], ring[(i + 1) % 4]);
      if (turn < 62 || turn > 118) return null;
    }
    if (Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) < 0.65 || Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]) < 0.65) return null;
    // The tilt is the average edge direction, folded to a quarter turn.
    let sin = 0;
    let cos = 0;
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % 4];
      const angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
      sin += Math.sin(4 * angle);
      cos += Math.cos(4 * angle);
    });
    let tilt = Math.atan2(sin, cos) / 4;
    if (Math.abs(tilt) < LEVEL) tilt = 0;
    const local = ring.map(([x, y]) => rotate(x, y, -tilt));
    const lx = local.map((p) => p[0]);
    const ly = local.map((p) => p[1]);
    let half = [(Math.max(...lx) - Math.min(...lx)) / 2, (Math.max(...ly) - Math.min(...ly)) / 2];
    const mid = [(Math.max(...lx) + Math.min(...lx)) / 2, (Math.max(...ly) + Math.min(...ly)) / 2];
    const square = Math.min(...half) / Math.max(...half) > 0.88;
    if (square) half = [(half[0] + half[1]) / 2, (half[0] + half[1]) / 2];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotate(mid[0] + sx * half[0], mid[1] + sy * half[1], tilt));
    return { kind: square ? "square" : "rectangle", points: closedFrom(corners) };
  }

  function snapTriangle(ring, diag) {
    if (ring.length !== 3) return null;
    const sides = ring.map((p, i) => dist(p, ring[(i + 1) % 3]));
    if (Math.min(...sides) < diag * 0.25) return null;
    for (let i = 0; i < 3; i += 1) {
      const interior = 180 - turnAngle(ring[(i + 2) % 3], ring[i], ring[(i + 1) % 3]);
      if (interior < 22) return null;
    }
    return { kind: "triangle", points: closedFrom(ring) };
  }

  // A circle or ellipse: the tilt comes from the spread of the points, and the outline must hug the fit all the way round.
  function snapEllipse(path, fit) {
    const n = path.length;
    const mx = path.reduce((sum, p) => sum + p[0], 0) / n;
    const my = path.reduce((sum, p) => sum + p[1], 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of path) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    let tilt = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const local = path.map(([x, y]) => rotate(x - mx, y - my, -tilt));
    const lx = local.map((p) => p[0]);
    const ly = local.map((p) => p[1]);
    const cu = (Math.max(...lx) + Math.min(...lx)) / 2;
    const cv = (Math.max(...ly) + Math.min(...ly)) / 2;
    let a = (Math.max(...lx) - Math.min(...lx)) / 2;
    let b = (Math.max(...ly) - Math.min(...ly)) / 2;
    if (a < 8 || b < 8) return null;
    let sum = 0;
    let worst = 0;
    const seen = new Array(24).fill(false);
    for (const [u, v] of local) {
      const dev = Math.abs(Math.hypot((u - cu) / a, (v - cv) / b) - 1);
      sum += dev;
      worst = Math.max(worst, dev);
      seen[Math.min(23, Math.floor(((Math.atan2(v - cv, u - cu) + Math.PI) / (2 * Math.PI)) * 24))] = true;
    }
    if (sum / n > 0.1 * fit || worst > 0.3 * fit || seen.filter(Boolean).length < 21) return null;
    const [ox, oy] = rotate(cu, cv, tilt);
    const centre = [mx + ox, my + oy];
    const round = Math.min(a, b) / Math.max(a, b) > 0.84;
    if (round) { a = (a + b) / 2; b = a; tilt = 0; }
    else {
      // Close to level or upright, an ellipse sits exactly level or upright.
      const quarter = Math.round(tilt / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(tilt - quarter) < LEVEL) tilt = quarter;
    }
    const outline = [];
    for (let i = 0; i <= 72; i += 1) {
      const t = (i / 72) * Math.PI * 2 - Math.PI / 2;
      const [x, y] = rotate(a * Math.cos(t), b * Math.sin(t), tilt);
      outline.push([centre[0] + x, centre[1] + y]);
    }
    return { kind: round ? "circle" : "ellipse", points: densify(outline) };
  }

  // A closed stroke: a triangle, a rectangle or square, or a circle or ellipse.
  function snapClosed(points, diag, fit) {
    if (diag < 40 || dist(points[0], points[points.length - 1]) > diag * 0.25 || pathLength(points) < diag * 2) return null;
    const path = resample(points, Math.max(2, diag / 80));
    if (path.length < 12) return null;
    const ring = cornersOf(path, diag);
    if (!ring) return null;
    return snapTriangle(ring, diag) || snapRectangle(ring) || (ring.length >= 5 ? snapEllipse(path, fit) : null);
  }

  // A shaft with a two-barbed head drawn in one go: A to the tip, out along one barb, back to the tip, out along the other.
  function snapArrow(points, diag) {
    if (diag < 50) return null;
    const path = resample(points, Math.max(2, diag / 80));
    if (path.length < 12) return null;
    const v = simplifyPath(path, diag * 0.045);
    if (v.length !== 5) return null;
    const [a, tip, c, again, d] = v;
    const shaft = dist(a, tip);
    const barbs = [dist(tip, c), dist(again, d)];
    if (dist(tip, again) > Math.min(...barbs) * 0.45) return null;
    if (Math.min(...barbs) < shaft * 0.12 || Math.max(...barbs) > shaft * 0.55 || Math.max(...barbs) / Math.min(...barbs) > 1.8) return null;
    const back = Math.atan2(a[1] - tip[1], a[0] - tip[0]);
    const swing = (end) => {
      const angle = Math.atan2(end[1] - tip[1], end[0] - tip[0]) - back;
      return Math.atan2(Math.sin(angle), Math.cos(angle));
    };
    const [sc, sd] = [swing(c), swing(d)];
    if (sc * sd >= 0) return null; // the barbs must sit on opposite sides of the shaft
    const spread = (Math.abs(sc) + Math.abs(sd)) / 2;
    if (spread < (12 * Math.PI) / 180 || spread > (70 * Math.PI) / 180) return null;
    const length = Math.min(Math.max((barbs[0] + barbs[1]) / 2, shaft * 0.1), shaft * 0.28);
    const angle = Math.min(Math.max(spread, (20 * Math.PI) / 180), (45 * Math.PI) / 180);
    let end = tip;
    const heading = Math.atan2(tip[1] - a[1], tip[0] - a[0]);
    const nearest = Math.round(heading / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(heading - nearest) < LEVEL) end = [a[0] + Math.cos(nearest) * shaft, a[1] + Math.sin(nearest) * shaft];
    const aim = Math.abs(heading - nearest) < LEVEL ? nearest : heading;
    const wing = (side) => [end[0] + Math.cos(aim + Math.PI + side * angle) * length, end[1] + Math.sin(aim + Math.PI + side * angle) * length];
    return densify([a, end, wing(1), end, wing(-1)]);
  }

  // Recognises a stroke: { kind, points } with clean points, or null to leave it as drawn.
  // opts.minSize ignores anything smaller than that across (a page-wide pass skips handwriting that way);
  // opts.careful asks for a closer fit.
  function snapKind(points, opts = {}) {
    if (!points || points.length < 4) return null;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (opts.minSize && diag < opts.minSize) return null;
    const line = snapLine(points);
    if (line) return { kind: "line", points: line };
    const closed = snapClosed(points, diag, opts.careful ? 0.7 : 1);
    if (closed) return closed;
    const arrow = snapArrow(points, diag);
    if (arrow) return { kind: "arrow", points: arrow };
    const bracket = snapBracket(points);
    return bracket ? { kind: "bracket", points: bracket } : null;
  }

  // Returns clean points for a recognised shape, or null to leave the stroke as drawn.
  function snap(points, opts) {
    const found = snapKind(points, opts);
    // Snapped shapes carry no pressure: they are as thick as the Width setting says, every time.
    return found ? found.points.map(([x, y]) => [x, y]) : null;
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

  // A pen's colour on a paper: the built-in colours (PALETTE) are nudged to stay readable, but a colour you
  // picked yourself (the wheel, the eyedropper, a saved palette colour) is drawn exactly as picked, white included.
  const builtIn = new Set(PALETTE.map(({ color }) => color.toLowerCase()));
  function penColorOn(color, paper) {
    return builtIn.has(String(color).toLowerCase()) ? colorOn(color, paper) : color;
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

  window.SkybridgeInk = { fill, snap, snapKind, hold, PALETTE, colorOn, penColorOn, paperOf, isHex, layered, scribble, crossed, inside, bounds, NIBS, setSmoothing, tidy, DEFAULT_SMOOTHING };
})();
