/*
 * Gemini Live as a reader: open a short Live session with your own key, send it one picture and a question, collect
 * what it says, and close the session. The Live models have no per-day request limit on the free key (only a
 * tokens-per-minute cap), so this saves the 20-a-day Flash requests.
 *
 * Live models answer by voice, so the reply is read from the output transcription (the same way Skybridge's own
 * Live session gets its captions). The key goes straight from this iPad to Google in the connection address; no
 * ephemeral token is needed for your own key. One session per request, one at a time.
 *
 * window.SkybridgeLive = { config(), save(patch), usable(), ask({ image, prompt }), test(), used(), onUsage(fn), MODELS }
 */
(() => {
  const KEY = "skybridge.live";
  const USAGE_KEY = "skybridge.liveUsage";
  const HOST = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  const MODELS = [
    { id: "gemini-3.8-live", label: "Gemini 3.8 Live" },
    { id: "gemini-3.8-live-extended-thinking", label: "Gemini 3.8 Live Extended Thinking" },
  ];
  const DEFAULTS = { on: false, model: MODELS[0].id, check: false };
  const SETUP_MS = 15000;
  const TURN_MS = 60000;
  const listeners = new Set();
  let tail = Promise.resolve();

  class LiveError extends Error {
    constructor(message, kind = "live") { super(message); this.kind = kind; }
  }

  const config = () => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
  };
  const save = (patch) => {
    const next = { ...config(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    return next;
  };

  const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  function used() {
    try {
      const saved = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
      if (saved.day === day()) return saved.count || 0;
    } catch {}
    return 0;
  }
  function count() {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify({ day: day(), count: used() + 1 })); } catch {}
    listeners.forEach((fn) => fn());
  }

  const keyOf = () => { try { return localStorage.getItem("skybridge.geminiKey") || ""; } catch { return ""; } };
  const usable = () => config().on && Boolean(keyOf()) && typeof WebSocket === "function" && navigator.onLine !== false;

  // Pictures go as JPEG: much smaller than the PNG the board makes, and Live takes either.
  async function toJpeg(base64Png) {
    try {
      const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return { mime: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
    } catch {
      return { mime: "image/png", data: base64Png };
    }
  }

  const textOfFrame = async (data) => (typeof data === "string" ? data : data instanceof Blob ? data.text() : new TextDecoder().decode(data));

  function session({ model, image, prompt }) {
    return new Promise((resolve, reject) => {
      let socket;
      let said = "";
      let ready = false;
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { socket.close(1000); } catch {}
        if (error) reject(error); else resolve(value);
      };
      let timer = setTimeout(() => finish(new LiveError("Gemini Live didn't connect.", "timeout")), SETUP_MS);
      try {
        socket = new WebSocket(`${HOST}?key=${encodeURIComponent(keyOf())}`);
      } catch {
        finish(new LiveError("Couldn't open a Live connection.", "network"));
        return;
      }
      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: "You read a student's handwriting from a picture and answer only with what was asked, in plain words. No greeting, no commentary." }] },
          },
        }));
      };
      socket.onmessage = async (event) => {
        let message;
        try { message = JSON.parse(await textOfFrame(event.data)); } catch { return; }
        if (message.setupComplete && !ready) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(new LiveError("Gemini Live took too long to answer.", "timeout")), TURN_MS);
          const parts = [...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []), { text: prompt }];
          socket.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts }], turnComplete: true } }));
          return;
        }
        const content = message.serverContent;
        if (content) {
          if (content.outputTranscription?.text) said += content.outputTranscription.text;
          for (const part of content.modelTurn?.parts || []) if (typeof part.text === "string") said += part.text;
          if (content.turnComplete || content.generationComplete) finish(null, said);
        }
        if (message.error) finish(new LiveError(String(message.error.message || "Gemini Live refused the request.").slice(0, 200)));
      };
      socket.onerror = () => { if (!ready) finish(new LiveError("Couldn't reach Gemini Live.", "network")); };
      socket.onclose = (event) => {
        if (done) return;
        const why = String(event.reason || "").slice(0, 200);
        const rejected = /api key|permission|invalid/i.test(why) || event.code === 1008;
        finish(new LiveError(why || (ready ? "Gemini Live closed before it finished." : "Gemini Live closed the connection."), rejected ? "key" : "live"));
      };
    });
  }

  // One session per request, one at a time. `image` is a base64 PNG of the page (or null for a words-only test).
  function ask({ image, prompt }) {
    const run = tail.then(async () => {
      const cfg = config();
      const picture = image ? await toJpeg(image) : null;
      const text = (await session({ model: cfg.model, image: picture, prompt })).trim();
      if (!text) throw new LiveError("Gemini Live said nothing.", "empty");
      count();
      return { model: MODELS.find((m) => m.id === cfg.model)?.label || cfg.model, text };
    });
    tail = run.catch(() => {});
    return run;
  }

  // A real check: a picture with handwriting-like text in it, read back.
  async function test() {
    const started = Date.now();
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 480, 160);
      ctx.fillStyle = "#111";
      ctx.font = "48px sans-serif";
      ctx.fillText("A = 3 and B = 7", 24, 96);
      const image = canvas.toDataURL("image/png").split(",")[1];
      const result = await ask({ image, prompt: "Say exactly what is written in the picture, and nothing else." });
      return { ok: true, text: result.text.slice(0, 120), ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  window.SkybridgeLive = { config, save, usable, ask, test, used, onUsage: (fn) => listeners.add(fn), MODELS, LiveError };
})();
