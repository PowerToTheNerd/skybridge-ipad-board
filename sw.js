/*
 * Keeps the board on the iPad so it opens and works without the PC.
 *
 * The relay fills in the version below (it changes whenever a board file does, which is what makes
 * the iPad fetch the new files) and the list of every file the board needs. Notebooks are not
 * kept here; they are in IndexedDB (notebooks.js).
 */
const VERSION = "4a6031e3ef3d";
const CACHE = `skybridge-board-${VERSION}`;
// Paths are relative to where this file lives, so the same file works at the root of the PC relay
// and in a folder of a static site (like https://name.github.io/board/).
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = ["./", "ai.js", "export.js", "icon-192.png", "icon-512.png", "icon.png", "icon.svg", "inkstroke.js", "marks.js", "mathcheck.js", "notebooks.js", "pad.css", "pad.js", "perfect-freehand.js", "practice.js", "smart.js", "vendor/fonts/Virgil-Regular.woff2", "vendor/fonts/inter-latin-400-normal.woff2", "vendor/fonts/inter-latin-500-normal.woff2", "vendor/fonts/inter-latin-600-normal.woff2", "vendor/fonts/inter-latin-700-normal.woff2", "vendor/fonts/jetbrains-mono-latin-400-normal.woff2", "vendor/fonts/jetbrains-mono-latin-500-normal.woff2", "vendor/fonts/jetbrains-mono-latin-600-normal.woff2", "vendor/fonts/jetbrains-mono-latin-700-normal.woff2", "vendor/fonts/roboto-latin-400-normal.woff2", "vendor/fonts/roboto-latin-500-normal.woff2", "vendor/fonts/roboto-latin-600-normal.woff2", "vendor/fonts/roboto-latin-700-normal.woff2", "vendor/katex/fonts/KaTeX_AMS-Regular.woff2", "vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2", "vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2", "vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2", "vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2", "vendor/katex/fonts/KaTeX_Main-Bold.woff2", "vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2", "vendor/katex/fonts/KaTeX_Main-Italic.woff2", "vendor/katex/fonts/KaTeX_Main-Regular.woff2", "vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2", "vendor/katex/fonts/KaTeX_Math-Italic.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2", "vendor/katex/fonts/KaTeX_Script-Regular.woff2", "vendor/katex/fonts/KaTeX_Size1-Regular.woff2", "vendor/katex/fonts/KaTeX_Size2-Regular.woff2", "vendor/katex/fonts/KaTeX_Size3-Regular.woff2", "vendor/katex/fonts/KaTeX_Size4-Regular.woff2", "vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2", "vendor/katex/katex.min.css", "vendor/katex/katex.min.js", "vendor/perfect-freehand.js", "vendor/rough.js", "whiteboard.css", "whiteboard.js"].map((url) => new URL(url, self.registration.scope).pathname);
const SHELL_PATHS = new Set(SHELL);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // "reload" so a file the browser's own cache holds is not saved by mistake.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("skybridge-board-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// The board page, opened from the Home Screen or a bookmark, with or without the pairing code.
async function page(request) {
  const cached = await caches.match(SCOPE, { cacheName: CACHE });
  if (!cached) return fetch(request);
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return cached;
  // Keep the Home Screen link paired: the page tells the manifest which code to start with.
  const html = (await cached.text()).replace(
    'href="./manifest.webmanifest"',
    `href="./manifest.webmanifest?code=${encodeURIComponent(code)}"`,
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && (url.pathname === SCOPE || url.pathname === `${SCOPE}index.html`)) {
    event.respondWith(page(request).catch(() => fetch(request)));
    return;
  }
  if (!SHELL_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(url.pathname, { cacheName: CACHE });
    return cached || fetch(request);
  })());
});
