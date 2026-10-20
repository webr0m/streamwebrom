// Video effects for the camera, VDO.Ninja-style (&effects): background blur,
// virtual background (image, video or solid/chroma colour) and "replace my
// camera with an image or video". Everything runs locally in the browser:
// person segmentation uses MediaPipe's selfie segmenter, vendored under
// /vendor/mediapipe (no CDN), and the result is a canvas track that is sent
// like a normal camera.
//
// Design notes
// - Segmentation runs on a small copy of the frame (~256 px wide) and the mask
//   is scaled up with smoothing, which gives soft edges and keeps CPU low.
// - Blur is done by down-scaling and up-scaling (works everywhere, including
//   Safari, where canvas `filter` is missing).
// - Segmentation runs in a dedicated Worker with one transferable bitmap in
//   flight. Camera rendering stays fresh while the mask is being calculated.
import { segmentationClient } from "./segmentation-client.js";
import { effectBudget } from "./effect-budget.js";
import { el, toast } from "./rtc.js";

export const EFFECTS = [
  ["none", "Sin efecto"],
  ["blur", "Desenfocar fondo"],
  ["blur-strong", "Desenfocar fondo (fuerte)"],
  ["bg", "Fondo virtual (imagen, video o color)"],
  ["replace", "Reemplazar mi cámara por imagen o video"],
];

// Built-in backgrounds (drawn, so nothing to download).
export const PRESETS = [
  ["studio", "Estudio morado", ["#2a1458", "#7c5cff"]],
  ["night", "Azul noche", ["#050b1f", "#1e4fa8"]],
  ["sunset", "Atardecer", ["#ff6a3d", "#9b2c8f"]],
  ["office", "Gris oficina", ["#3b4250", "#a7aebb"]],
  ["green", "Verde croma (para OBS)", ["#00b140", "#00b140"]],
  ["blue", "Azul croma", ["#0047bb", "#0047bb"]],
];

// Images/videos the user picked this session (object URLs are not persisted;
// small images are also kept as data: URLs in prefs so they survive a reload).
const assets = { bg: null, replace: null };

/** Remember an uploaded file for "bg" or "replace". Returns a short description. */
export async function setAsset(slot, file, prefs) {
  if (!file) return "";
  if (!/^(image|video)\//.test(file.type)) throw new Error("Usa una imagen (JPG, PNG, WebP, GIF) o un video (MP4, WebM).");
  if (file.size > 300 * 1024 * 1024) throw new Error("Archivo muy grande (máx. 300 MB).");
  const url = URL.createObjectURL(file);
  assets[slot]?.revoke?.();
  assets[slot] = { url, kind: file.type.startsWith("video/") ? "video" : "image", name: file.name, revoke: () => URL.revokeObjectURL(url) };
  if (assets[slot].kind === "image" && file.size < 1.5 * 1024 * 1024) {
    prefs[slot === "bg" ? "effectBgImage" : "effectReplaceImage"] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  } else delete prefs[slot === "bg" ? "effectBgImage" : "effectReplaceImage"];
  return file.name;
}

function assetFor(slot, prefs) {
  if (assets[slot]) return assets[slot];
  const saved = prefs[slot === "bg" ? "effectBgImage" : "effectReplaceImage"];
  return saved ? { url: saved, kind: "image", name: "imagen guardada" } : null;
}

export const effectActive = (p) => !!p.effect && p.effect !== "none";
export const needsCamera = (p) => p.effect !== "replace";

// ---------- frame clock that survives background tabs ----------
let ticker = null;
const tickers = new Set();
function onTick(fn) {
  if (!ticker) {
    try {
      ticker = new Worker(new URL("./ticker.js", import.meta.url));
      ticker.onmessage = () => { try { tickers.forEach((f) => f()); } finally { ticker?.postMessage(0); } };
    } catch { ticker = { postMessage() {}, fallback: setInterval(() => tickers.forEach((f) => f()), 33) }; }
  }
  tickers.add(fn);
  return () => {
    tickers.delete(fn);
    if (!tickers.size && ticker) { ticker.terminate?.(); clearInterval(ticker.fallback); ticker = null; }
  };
}

function mediaElement(asset) {
  if (!asset) return null;
  if (asset.kind === "video") {
    const v = el("video", { playsinline: true, autoplay: true, loop: true });
    v.muted = true; v.src = asset.url; v.play().catch(() => {});
    return v;
  }
  const img = new Image(); img.src = asset.url;
  return img;
}
const ready = (m) => m && (m instanceof HTMLVideoElement ? m.readyState >= 2 : m.complete && m.naturalWidth > 0);
const dims = (m) => m instanceof HTMLVideoElement ? [m.videoWidth, m.videoHeight] : [m.naturalWidth || m.width, m.naturalHeight || m.height];

/** Draw `m` to cover (crop) the whole canvas. */
function cover(ctx, m, W, H) {
  const [w, h] = dims(m);
  if (!w || !h) return;
  const s = Math.max(W / w, H / h), dw = w * s, dh = h * s;
  ctx.drawImage(m, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function paintPreset(ctx, id, W, H) {
  const p = PRESETS.find((x) => x[0] === id) || PRESETS[0];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, p[2][0]); g.addColorStop(1, p[2][1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/**
 * Wrap a camera video track (or nothing, for "replace") with the chosen effect.
 * Returns a new MediaStreamTrack; stopping it stops the camera too.
 * `raw` is kept on the result for camera controls and device info.
 */
export async function applyEffect(track, p) {
  const mode = p.effect && p.effect !== "none" ? p.effect : "none";
  const flipH = !!p.flipH, flipV = !!p.flipV;
  const fps = Math.min(60, Number(p.fps) || 30);
  const profile = p.effectPerformance || "fast";
  const set = track?.getSettings?.() || {};
  // Start from the reported settings, then follow the real frame size: phones
  // report landscape settings for portrait frames, and the quality can change
  // later. Drawing a frame into a canvas of another shape squashed faces.
  let H = Number(set.height) || Math.min(Number(p.quality) || 720, 1080);
  let W = Number(set.width) || Math.round(H * 16 / 9);
  const canvas = el("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const cam = track ? el("video", { playsinline: true, autoplay: true }) : null;
  if (cam) { cam.muted = true; cam.srcObject = new MediaStream([track]); await cam.play().catch(() => {}); }

  const bgAsset = mode === "bg" && !p.effectPreset ? mediaElement(assetFor("bg", p)) : null;
  const replaceAsset = mode === "replace" ? mediaElement(assetFor("replace", p)) : null;
  if (mode === "replace" && !replaceAsset) toast("Elige una imagen o video para reemplazar tu cámara.", "err");

  const segmented = ["blur", "blur-strong", "bg"].includes(mode);
  let client = null;
  const SW = 256;
  let SH = 2;
  const small = el("canvas");
  const sctx = small.getContext("2d", { willReadFrequently: true });
  // The mask canvas follows the mask's own size (MediaPipe may hand back a
  // different size than the input); copying it row by row into a canvas of
  // another width slid the person down the frame.
  const maskC = el("canvas"); maskC.width = 2; maskC.height = 2;
  const mctx = maskC.getContext("2d");
  let maskData = null, haveMask = false, maskAt = 0, maskInterval = 1000 / 12;
  const blurC = el("canvas"); const blurPx = mode === "blur-strong" ? 16 : 40;
  const bctx = blurC.getContext("2d");
  const fg = el("canvas");
  const fctx = fg.getContext("2d");
  function resize(w, h) {
    const bounded = mode === "none" ? { width: w, height: h, maskInterval: 1000 } : effectBudget(profile, w, h);
    W = bounded.width; H = bounded.height; maskInterval = bounded.maskInterval;
    canvas.width = fg.width = W; canvas.height = fg.height = H;
    SH = Math.max(2, Math.round(SW * H / W));
    small.width = SW; small.height = SH;
    blurC.width = Math.max(2, Math.round(W / blurPx)); blurC.height = Math.max(2, Math.round(H / blurPx));
  }
  resize(W, H);
  let stopped = false, lastRun = 0, cost = 0, lastSeg = -Infinity, videoClock = -1;
  const metrics = { frames: 0, renderMs: 0, worker: null, mode: profile, maxInFlight: 1 };
  if (segmented) {
    try {
      client = segmentationClient(W >= H && profile !== "detail", data => {
        if (stopped || performance.now() - data.captured > 500) return;
        if (!maskData || maskData.width !== data.width || maskData.height !== data.height) {
          maskC.width = data.width; maskC.height = data.height; maskData = mctx.createImageData(data.width, data.height);
        }
        maskData.data.set(new Uint8Array(data.rgba)); mctx.putImageData(maskData, 0, 0);
        haveMask = true; maskAt = data.captured;
      });
      await client.loaded; metrics.worker = client.metrics;
    } catch (e) {
      client?.stop(); cam?.pause(); if (cam) cam.srcObject = null;
      bgAsset?.pause?.(); replaceAsset?.pause?.();
      console.warn("segmenter worker", e); toast("No se pudo iniciar el efecto sin bloquear la cámara; envío la cámara normal.", "err");
      return track;
    }
  }

  function background() {
    if (mode === "bg") {
      if (p.effectPreset) return paintPreset(ctx, p.effectPreset, W, H);
      if (ready(bgAsset)) return cover(ctx, bgAsset, W, H);
      return paintPreset(ctx, "studio", W, H);
    }
    // blur: tiny copy scaled back up
    bctx.drawImage(cam, 0, 0, blurC.width, blurC.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(blurC, 0, 0, W, H);
  }

  // Flip what everyone sees (whole output: camera and background).
  const flip = () => ctx.setTransform(flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? W : 0, flipV ? H : 0);
  function frame() {
    if (stopped) return;
    const t0 = performance.now();
    if (t0 - lastRun < Math.max(1000 / fps - 3, cost * 1.5)) return;
    if (cam && cam.currentTime === videoClock) return;
    if (cam) videoClock = cam.currentTime;
    lastRun = t0;
    try { flip(); draw(t0); out.requestFrame?.(); metrics.frames++; }
    catch (e) { console.warn("effect render", e); }
    finally { ctx.setTransform(1, 0, 0, 1, 0, 0); cost = cost * .8 + (performance.now() - t0) * .2; metrics.renderMs = cost; }
  }
  let sourceW = set.width || W, sourceH = set.height || H;
  function draw(t0) {
    if (mode === "replace") {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      if (ready(replaceAsset)) cover(ctx, replaceAsset, W, H);
      return;
    }
    if (!cam || cam.readyState < 2) return;
    if (cam.videoWidth && cam.videoHeight && (cam.videoWidth !== sourceW || cam.videoHeight !== sourceH)) {
      sourceW = cam.videoWidth; sourceH = cam.videoHeight; resize(sourceW, sourceH); haveMask = false; flip();
    }
    if (mode === "none") { ctx.drawImage(cam, 0, 0, W, H); return; }
    if (client && t0 - lastSeg >= Math.max(maskInterval, (client.metrics.inferenceMs || 0) * 1.5)) {
      lastSeg = t0; sctx.drawImage(cam, 0, 0, SW, SH);
      client.submit(small, t0);
    }
    // Always composite the freshest camera frame. A late mask never queues or
    // freezes video. If its mask is late, keep a fully blurred/replaced
    // background until it catches up instead of exposing an unprocessed room.
    if (!haveMask || t0 - maskAt > 500 || client?.metrics.failed) { background(); return; }
    fctx.globalCompositeOperation = "copy"; fctx.imageSmoothingEnabled = true;
    fctx.drawImage(maskC, 0, 0, W, H);
    fctx.globalCompositeOperation = "source-in"; fctx.drawImage(cam, 0, 0, W, H);
    background(); ctx.drawImage(fg, 0, 0);
  }

  let capture = canvas.captureStream(0), out = capture.getVideoTracks()[0];
  if (!out.requestFrame) { out.stop(); capture = canvas.captureStream(fps); out = capture.getVideoTracks()[0]; }
  const untick = onTick(frame);
  let callback = 0;
  const videoFrame = () => { if (stopped) return; frame(); callback = cam.requestVideoFrameCallback(videoFrame); };
  if (cam?.requestVideoFrameCallback) callback = cam.requestVideoFrameCallback(videoFrame);
  out.effectMetrics = metrics;
  out.contentHint = "motion";
  out.raw = track || null;
  out.effect = mode;
  const stopOut = out.stop.bind(out);
  const cleanup = () => { if (stopped) return; stopped = true; untick(); client?.stop(); if (callback) cam?.cancelVideoFrameCallback?.(callback); cam?.pause(); if (cam) cam.srcObject = null; track?.stop(); if (replaceAsset instanceof HTMLVideoElement) replaceAsset.pause(); if (bgAsset instanceof HTMLVideoElement) bgAsset.pause(); };
  out.stop = () => { cleanup(); stopOut(); };
  track?.addEventListener("ended", () => { cleanup(); stopOut(); });
  // enabling/disabling the output also pauses the camera light
  return out;
}

/** The "Efectos de video" block for the settings panel. onChange() reopens the camera. */
export function effectsPanel(prefs, onChange) {
  const sel = el("select", { id: "dev-effect" }, ...EFFECTS.map(([v, t]) => el("option", { value: v, text: t })));
  sel.value = prefs.effect || "none";
  const preset = el("select", { id: "dev-effect-preset" }, el("option", { value: "", text: "Mi imagen o video…" }), ...PRESETS.map(([v, t]) => el("option", { value: v, text: t })));
  preset.value = prefs.effectPreset || "";
  const file = el("input", { type: "file", accept: "image/*,video/*" });
  const info = el("span", { class: "muted", style: "font-size:12px" });
  const showInfo = () => {
    const slot = sel.value === "replace" ? "replace" : "bg";
    const a = assetFor(slot, prefs);
    info.textContent = a ? `Usando: ${a.name}` : (slot === "replace" || !preset.value ? "Aún no elegiste archivo." : "");
  };
  const performanceMode = el("select", { id: "dev-effect-performance" },
    el("option", { value: "fast", text: "Baja latencia (recomendado, hasta 720p)" }),
    el("option", { value: "balanced", text: "Equilibrado (hasta 1080p)" }),
    el("option", { value: "detail", text: "Más detalle (mayor consumo)" }));
  performanceMode.value = prefs.effectPerformance || "fast";
  performanceMode.onchange = () => { prefs.effectPerformance = performanceMode.value; onChange("video"); };
  const performanceRow = el("div", {}, el("label", { text: "Rendimiento del efecto" }), performanceMode);
  const presetRow = el("div", {}, el("label", { text: "Fondo" }), preset);
  const fileRow = el("div", {}, el("label", { text: "Imagen o video (se queda en tu equipo)" }), file, info);
  const sync = () => {
    presetRow.classList.toggle("hidden", sel.value !== "bg");
    fileRow.classList.toggle("hidden", !(sel.value === "replace" || (sel.value === "bg" && !preset.value)));
    showInfo();
  };
  sel.onchange = () => { prefs.effect = sel.value; sync(); onChange("video"); };
  preset.onchange = () => { prefs.effectPreset = preset.value; sync(); if (preset.value || assetFor("bg", prefs)) onChange("video"); };
  file.onchange = async () => {
    try {
      await setAsset(sel.value === "replace" ? "replace" : "bg", file.files[0], prefs);
      showInfo(); onChange("video");
    } catch (e) { toast(e.message, "err"); }
    file.value = "";
  };
  sync();
  return el("details", { class: "camdetails", open: effectActive(prefs) }, el("summary", { text: "✨ Efectos de video (fondo virtual, desenfoque, imagen)" }),
    el("div", { class: "col", style: "margin-top:8px" }, el("div", {}, el("label", { text: "Efecto" }), sel), performanceRow, presetRow, fileRow,
      el("p", { class: "muted", style: "margin:0;font-size:12px", text: "El recorte se procesa en un worker de tu equipo sin acumular fotogramas. Si el equipo se sobrecarga se prioriza video reciente. Para usar filtros de OBS, selecciona OBS Virtual Camera como cámara y deja este efecto desactivado." })));
}
