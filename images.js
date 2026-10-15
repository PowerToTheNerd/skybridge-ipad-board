/*
 * Photos on a page. A photo is a stroke on the page with `img` (the id of its picture), two corner points and
 * `lock`; the picture itself lives in the notebooks database (see notebooks.js, putPic/getPics) so saving ink
 * never rewrites it. This file shrinks what you import, keeps decoded pictures ready to draw, and draws them.
 *
 * window.SkybridgeImages = { prepare(file), add(pic), ensure(strokes), draw(ctx, stroke), onLoad(fn), MAX_SIDE }
 */
(() => {
  const MAX_SIDE = 1600; // long side in pixels: sharp on an iPad, and a few hundred KB each
  const QUALITY = 0.82;
  const cache = new Map(); // id -> HTMLImageElement (ready), or "loading" / "missing"
  const listeners = new Set();

  const newId = () => {
    const bytes = new Uint8Array(9);
    (self.crypto || window.crypto).getRandomValues(bytes);
    return "p" + Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
  };

  function decode(data) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That picture couldn't be opened."));
      image.src = data;
    });
  }

  // A photo or screenshot (a File or Blob) as a smaller JPEG: { id, data, w, h }. White behind any transparency.
  async function prepare(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await decode(url);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error("That picture couldn't be opened.");
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      return { id: newId(), data: canvas.toDataURL("image/jpeg", QUALITY), w, h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Keep a picture decoded and ready to draw, and tell the page when it arrives.
  async function add(pic) {
    try {
      cache.set(pic.id, await decode(pic.data));
    } catch {
      cache.set(pic.id, "missing");
    }
    listeners.forEach((fn) => fn(pic.id));
  }

  // Load the pictures these strokes use from the notebooks database (resolves when all are ready).
  async function ensure(strokes) {
    const need = [...new Set((strokes || []).filter((stroke) => stroke.img && !cache.has(stroke.img)).map((stroke) => stroke.img))];
    if (!need.length || !window.SkybridgeNotebooks) return;
    need.forEach((id) => cache.set(id, "loading"));
    const pics = await window.SkybridgeNotebooks.getPics(need);
    await Promise.all(need.map((id) => (pics.has(id) ? add(pics.get(id)) : (cache.set(id, "missing"), Promise.resolve()))));
  }

  // Draw one photo into its box. A picture still loading, or lost, shows as an empty frame.
  function draw(ctx, stroke) {
    const [[x0, y0], [x1, y1]] = stroke.points;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    const image = cache.get(stroke.img);
    ctx.save();
    if (image && typeof image === "object") {
      ctx.drawImage(image, left, top, width, height);
    } else {
      ctx.fillStyle = "rgba(128,128,128,0.15)";
      ctx.strokeStyle = "rgba(128,128,128,0.5)";
      ctx.setLineDash([6, 5]);
      ctx.fillRect(left, top, width, height);
      ctx.strokeRect(left, top, width, height);
    }
    ctx.restore();
  }

  window.SkybridgeImages = { prepare, add, ensure, draw, onLoad: (fn) => listeners.add(fn), MAX_SIDE };
})();
