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
// - A Worker drives the frame loop so it keeps running when the tab is in the
//   background (timers in hidden tabs are throttled to 1 Hz).
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

// ---------- MediaPipe (lazy) ----------
let segmenterP = null;
let segTs = 0; // one strictly increasing integer-ms clock shared by every pipeline (MediaPipe requires it)
const nextTs = () => (segTs = Math.max(Math.floor(performance.now()), segTs + 1));
function loadSegmenter() {
  if (segmenterP) return segmenterP;
  segmenterP = (async () => {
    const { ImageSegmenter } = await import("/vendor/mediapipe/vision_bundle.mjs");
    const fileset = { wasmLoaderPath: "/vendor/mediapipe/vision_wasm_internal.js", wasmBinaryPath: "/vendor/mediapipe/vision_wasm_internal.wasm" };
    const make = (delegate) => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/vendor/mediapipe/selfie_segmenter.tflite", delegate },
      runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true,
    });
    try { return await make("GPU"); } catch (e) { console.warn("segmenter GPU", e); return make("CPU"); }
  })();
  segmenterP.catch(() => { segmenterP = null; });
  return segmenterP;
}

// ---------- frame clock that survives background tabs ----------
let ticker = null;
const tickers = new Set();
function onTick(fn) {
  if (!ticker) {
    try {
      ticker = new Worker("/js/ticker.js");
      ticker.onmessage = () => tickers.forEach((f) => f());
    } catch { ticker = { postMessage() {}, fallback: setInterval(() => tickers.forEach((f) => f()), 33) }; }
  }
  tickers.add(fn);
  return () => tickers.delete(fn);
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
  const mode = p.effect;
  const fps = Math.min(60, Number(p.fps) || 30);
  const set = track?.getSettings?.() || {};
  const H = Number(set.height) || Math.min(Number(p.quality) || 720, 1080);
  const W = Number(set.width) || Math.round(H * 16 / 9);
  const canvas = el("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const cam = track ? el("video", { playsinline: true, autoplay: true }) : null;
  if (cam) { cam.muted = true; cam.srcObject = new MediaStream([track]); await cam.play().catch(() => {}); }

  const bgAsset = mode === "bg" && !p.effectPreset ? mediaElement(assetFor("bg", p)) : null;
  const replaceAsset = mode === "replace" ? mediaElement(assetFor("replace", p)) : null;
  if (mode === "replace" && !replaceAsset) toast("Elige una imagen o video para reemplazar tu cámara.", "err");

  // Segmentation for blur/bg.
  let seg = null;
  if (mode === "blur" || mode === "blur-strong" || mode === "bg") {
    try { seg = await loadSegmenter(); }
    catch (e) { console.warn("segmenter", e); toast("Este navegador no pudo cargar el recorte de fondo; envío la cámara normal.", "err"); return track; }
  }
  const SW = 256, SH = Math.max(2, Math.round(SW * H / W));
  const small = el("canvas"); small.width = SW; small.height = SH;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  const maskC = el("canvas"); maskC.width = SW; maskC.height = SH;
  const mctx = maskC.getContext("2d");
  const maskData = mctx.createImageData(SW, SH);
  const blurC = el("canvas"); const blurPx = mode === "blur-strong" ? 16 : 40;
  blurC.width = Math.max(2, Math.round(W / blurPx)); blurC.height = Math.max(2, Math.round(H / blurPx));
  const bctx = blurC.getContext("2d");
  const fg = el("canvas"); fg.width = W; fg.height = H;
  const fctx = fg.getContext("2d");
  let busy = false, stopped = false, errors = 0;
  // Adaptive budget: never use more than ~half of the main thread, so chat,
  // signalling and the UI stay responsive on slow machines. Ticks that arrive
  // while we're behind are dropped instead of queuing up.
  let lastRun = 0, cost = 0, lastSeg = 0, segCost = 0;

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

  function frame() {
    if (stopped || busy) return;
    const t0 = performance.now();
    if (t0 - lastRun < Math.max(1000 / fps - 4, cost * 2)) return;
    lastRun = t0;
    if (mode === "replace") {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      if (ready(replaceAsset)) cover(ctx, replaceAsset, W, H);
      return;
    }
    if (!cam || cam.readyState < 2) return;
    busy = true;
    try {
      if (t0 - lastSeg >= Math.max(1000 / 30, segCost * 3)) {
      lastSeg = t0;
      sctx.drawImage(cam, 0, 0, SW, SH);
      seg.segmentForVideo(small, nextTs(), (res) => {
        const m = res.confidenceMasks?.[0];
        if (!m) return;
        const f = m.getAsFloat32Array(), d = maskData.data;
        for (let i = 0, j = 3; i < f.length; i++, j += 4) d[j] = f[i] < 0.25 ? 0 : f[i] > 0.75 ? 255 : (f[i] - 0.25) * 510;
        mctx.putImageData(maskData, 0, 0);
      });
      segCost = segCost * 0.8 + (performance.now() - t0) * 0.2;
      }
      // person = camera masked by the (smoothed, up-scaled) mask
      fctx.globalCompositeOperation = "copy";
      fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = "high";
      fctx.drawImage(maskC, 0, 0, W, H);
      fctx.globalCompositeOperation = "source-in";
      fctx.drawImage(cam, 0, 0, W, H);
      background();
      ctx.drawImage(fg, 0, 0);
      errors = 0;
    } catch (e) {
      console.warn("effect frame", e);
      // A broken graph stays broken: rebuild the segmenter after a few failures.
      if (++errors === 5) { segmenterP = null; loadSegmenter().then((s2) => { seg = s2; errors = 0; }).catch(() => {}); }
    }
    busy = false;
    cost = cost * 0.8 + (performance.now() - t0) * 0.2;
  }

  const untick = onTick(frame);
  const out = canvas.captureStream(fps).getVideoTracks()[0];
  out.contentHint = "motion";
  out.raw = track || null;
  out.effect = mode;
  const stopOut = out.stop.bind(out);
  const cleanup = () => { stopped = true; untick(); track?.stop(); if (replaceAsset instanceof HTMLVideoElement) replaceAsset.pause(); if (bgAsset instanceof HTMLVideoElement) bgAsset.pause(); };
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
    el("div", { class: "col", style: "margin-top:8px" }, el("div", {}, el("label", { text: "Efecto" }), sel), presetRow, fileRow,
      el("p", { class: "muted", style: "margin:0;font-size:12px", text: "El recorte del fondo se hace en tu equipo; nada se sube a internet. Verde croma sirve para quitar el fondo en OBS." })));
}
