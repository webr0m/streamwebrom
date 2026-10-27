// Device manager: camera, microphone and speaker selection with the widest
// browser/hardware compatibility we can get (VDO.Ninja-style settings panel).
//
// - Every constraint is tried strictly first and then relaxed step by step
//   (exact device -> ideal device -> any device; exact resolution -> ideal ->
//   none), so odd capture cards, virtual cameras (OBS Virtual Camera, NDI,
//   Camo, Iriun, DroidCam), phones and old webcams still open.
// - Speakers use HTMLMediaElement.setSinkId where the browser supports it
//   (Chrome, Edge, Opera, Firefox 116+), and the panel hides it elsewhere.
// - Camera controls (zoom, focus, exposure, white balance, brightness, torch,
//   pan/tilt, background blur...) are generated from track.getCapabilities(),
//   so whatever the camera exposes becomes a slider or switch.
// - Mic gain is applied with a Web Audio GainNode only when != 100 %.
import { $, el, toast, params } from "./rtc.js";
import { applyEffect, effectActive, needsCamera, effectsPanel } from "./effects.js";
import { attachNativeAudio } from "./native-audio.js";

const STORE = "swr.devices";

export const QUALITIES = [
  ["2160", "4K (2160p)"], ["1440", "1440p"], ["1080", "1080p Full HD"], ["720", "720p HD (recomendado)"],
  ["540", "540p"], ["480", "480p"], ["360", "360p (conexión lenta)"], ["240", "240p (muy lenta)"],
];
export const FPS = ["60", "50", "30", "25", "24", "15", "10"];

// Suggested video bitrate per height (kbps), close to what VDO.Ninja uses.
export const kbpsFor = (h) => ({ 2160: 16000, 1440: 9000, 1080: 6000, 720: 2500, 540: 1800, 480: 1200, 360: 800, 240: 400 })[h] || 2500;

const truthy = (v) => v === "" || v === "1" || v === "true" || v === "on";
const flag = (...names) => names.some((n) => params.has(n) && truthy(params.get(n)));
const off = (...names) => names.some((n) => params.has(n) && ["0", "false", "off"].includes(params.get(n)));

/** Preferences, with VDO.Ninja-compatible URL parameters taking priority. */
export function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch {}
  p = { camera: "", mic: "", speaker: "", quality: "720", fps: "30", echo: true, denoise: true, autogain: true, stereo: false, mirror: true, gain: 100, codec: "", effect: "none", effectPreset: "", flipH: false, flipV: false, ...p };
  const g = (n) => params.get(n);
  // &quality=0/1/2 (VDO) or a height
  if (params.has("quality")) p.quality = ({ 0: "1080", 1: "720", 2: "360" })[g("quality")] || g("quality");
  if (g("height") || g("h")) p.quality = g("height") || g("h");
  if (g("fps") || g("framerate") || g("fr")) p.fps = g("fps") || g("framerate") || g("fr");
  if (off("echocancellation", "aec", "echo")) p.echo = false;
  if (off("denoise", "noisesuppression", "ns")) p.denoise = false;
  if (off("autogain", "agc")) p.autogain = false;
  if (flag("stereo", "proaudio")) { p.stereo = true; p.echo = p.denoise = p.autogain = false; }
  if (off("mirror")) p.mirror = false;
  if (flag("flip", "mirror")) p.mirror = true;
  // &fliph / &flipv: turn the camera that everyone sees (upside-down or mirrored cameras)
  if (flag("fliph", "flipx")) p.flipH = true;
  if (flag("flipv", "flipy")) p.flipV = true;
  if (g("codec")) p.codec = g("codec").toLowerCase();
  if (g("videodevice") || g("vdevice") || g("vd")) p.cameraHint = g("videodevice") || g("vdevice") || g("vd");
  if (g("audiodevice") || g("adevice") || g("ad")) p.micHint = g("audiodevice") || g("adevice") || g("ad");
  if (g("outputdevice") || g("sink") || g("od")) p.speakerHint = g("outputdevice") || g("sink") || g("od");
  if (flag("novideo", "nv", "audioonly") || g("videodevice") === "0") p.camera = "none";
  if (flag("noaudio", "na") || g("audiodevice") === "0") p.mic = "none";
  // &effects=blur|blur-strong|bg|replace|none (VDO.Ninja: &effects / &blur) and &bgpreset=green|studio|...
  if (g("effects") || g("effect")) p.effect = ({ 0: "none", 1: "blur", 2: "blur", 3: "blur-strong", 4: "bg", 5: "bg" })[g("effects") || g("effect")] || g("effects") || g("effect");
  if (params.has("blur")) p.effect = "blur";
  if (g("bgpreset")) { p.effect = "bg"; p.effectPreset = g("bgpreset"); }
  if (g("gain")) p.gain = Math.max(0, Math.min(400, Number(g("gain")) || 100));
  return p;
}

export function savePrefs(p) {
  const { cameraHint, micHint, speakerHint, ...keep } = p;
  try { localStorage.setItem(STORE, JSON.stringify(keep)); return; } catch { delete keep.effectBgImage; delete keep.effectReplaceImage; } // quota: drop saved images
  try { localStorage.setItem(STORE, JSON.stringify(keep)); } catch { /* Storage may be disabled; preferences still work for this session. */ }
}

export const canPickSpeaker = () => "setSinkId" in HTMLMediaElement.prototype;

/** Route an <audio>/<video> to the chosen speaker (no-op when unsupported). */
export async function applySink(media, sinkId) {
  if (!media || !canPickSpeaker()) return;
  try { if (media.sinkId !== (sinkId || "")) await media.setSinkId(sinkId || ""); } catch (e) { console.warn("setSinkId", e); }
}

export async function listDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return { cams: [], mics: [], speakers: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind) => all.filter((d) => d.kind === kind && d.deviceId !== "communications");
  return { cams: pick("videoinput"), mics: pick("audioinput"), speakers: pick("audiooutput") };
}

/** Match "1", "obs", "Logitech" etc. (VDO-style &videodevice=) to a device. */
function resolveHint(list, hint) {
  if (!hint) return "";
  const n = Number(hint);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return list[n - 1].deviceId;
  const h = hint.toLowerCase().replace(/_/g, " ");
  return list.find((d) => d.label.toLowerCase().includes(h))?.deviceId || "";
}

function videoConstraint(p, strict) {
  if (p.camera === "none") return false;
  const h = Number(p.quality) || 720, fps = Number(p.fps) || 30;
  const c = {};
  if (p.camera) c.deviceId = strict ? { exact: p.camera } : { ideal: p.camera };
  if (strict === "loose") return Object.keys(c).length ? c : true;
  c.width = { ideal: Math.round(h * 16 / 9) };
  c.height = { ideal: h };
  c.frameRate = { ideal: fps, max: Math.max(fps, 30) };
  return c;
}

function audioConstraint(p, strict) {
  if (p.mic === "none") return false;
  const c = {
    echoCancellation: !!p.echo, noiseSuppression: !!p.denoise, autoGainControl: !!p.autogain,
    channelCount: p.stereo ? { ideal: 2 } : { ideal: 1 }, sampleRate: { ideal: 48000 },
  };
  if (p.stereo) { c.latency = { ideal: 0.01 }; }
  if (p.mic) c.deviceId = strict ? { exact: p.mic } : { ideal: p.mic };
  // Chrome-only legacy flags still honoured by some builds.
  c.googEchoCancellation = !!p.echo; c.googNoiseSuppression = !!p.denoise; c.googAutoGainControl = !!p.autogain;
  return c;
}

/** getUserMedia that tells the user when the browser is waiting on a permission prompt and never hangs forever. */
function gum(c) {
  let hint;
  const wait = setTimeout(() => { hint = true; toast("Esperando permiso de cámara/micrófono: revisa el aviso del navegador (candado en la barra de direcciones).", "err"); }, 4000);
  const timeout = new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("el navegador no respondió al pedir permiso"), { name: "TimeoutError" })), 45000));
  return Promise.race([navigator.mediaDevices.getUserMedia(c), timeout]).finally(() => { clearTimeout(wait); void hint; });
}

/**
 * Open camera+mic with progressive fallbacks. Never throws when at least one
 * device works; returns { stream, warnings[] }.
 */
export async function openMedia(p) {
  const r = await openRaw(effectActive(p) && !needsCamera(p) ? { ...p, camera: "none" } : p);
  if (!effectActive(p) && !p.flipH && !p.flipV) return r;
  const cam = r.stream.getVideoTracks()[0];
  if (!cam && needsCamera(p)) return r;
  try {
    const fx = await applyEffect(cam || null, p);
    if (fx !== cam) { if (cam) r.stream.removeTrack(cam); r.stream.addTrack(fx); }
  } catch (e) { console.warn("effect", e); r.warnings.push("No se pudo aplicar el efecto de video; envío la cámara normal."); }
  return r;
}

async function openRaw(p) {
  const warnings = [];
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: new MediaStream(), warnings: ["Este navegador no permite cámara ni micrófono (¿página sin HTTPS?)."] };
  }
  const devs = await listDevices();
  if (p.cameraHint && !p.camera) p.camera = resolveHint(devs.cams, p.cameraHint);
  if (p.micHint && !p.mic) p.mic = resolveHint(devs.mics, p.micHint);
  if (p.speakerHint && !p.speaker) p.speaker = resolveHint(devs.speakers, p.speakerHint);

  const tries = [
    [videoConstraint(p, true), audioConstraint(p, true)],
    [videoConstraint(p, false), audioConstraint(p, false)],
    [videoConstraint(p, "loose"), audioConstraint(p, false)],
    [videoConstraint({ ...p, camera: p.camera === "none" ? "none" : "" }, "loose"), audioConstraint({ ...p, mic: p.mic === "none" ? "none" : "" }, false)],
  ];
  let lastErr;
  for (const [video, audio] of tries) {
    if (!video && !audio) return { stream: new MediaStream(), warnings };
    try {
      const s = await gum({ video, audio });
      return { stream: await withGain(s, p), warnings };
    } catch (e) {
      lastErr = e;
      if (["NotAllowedError", "SecurityError", "TimeoutError"].includes(e.name)) break;
    }
  }
  // Last resort: open each kind on its own so a broken camera doesn't kill the mic.
  const out = new MediaStream();
  for (const kind of ["audio", "video"]) {
    if ((kind === "audio" && p.mic === "none") || (kind === "video" && p.camera === "none")) continue;
    if (lastErr && lastErr.name === "TimeoutError") break;
    try { (await gum({ [kind]: true })).getTracks().forEach((t) => out.addTrack(t)); }
    catch (e) { warnings.push(explain(e, kind)); }
  }
  if (!out.getTracks().length && lastErr) warnings.unshift(explain(lastErr));
  return { stream: await withGain(out, p), warnings: [...new Set(warnings)].slice(0, 2) };
}

export function explain(e, kind) {
  const what = kind === "video" ? "la cámara" : kind === "audio" ? "el micrófono" : "cámara/micrófono";
  switch (e?.name) {
    case "NotAllowedError": return `Permiso denegado para ${what}. Actívalo en el candado de la barra de direcciones.`;
    case "NotFoundError": return `No se encontró ${what}.`;
    case "NotReadableError": return `${what[0].toUpperCase() + what.slice(1)} está en uso por otra aplicación (Zoom, Teams, OBS…).`;
    case "TimeoutError": return `El navegador no respondió al pedir permiso para ${what}.`;
    case "OverconstrainedError": return `${what[0].toUpperCase() + what.slice(1)} no soporta esa configuración; usando la más cercana.`;
    default: return `No se pudo abrir ${what}: ${e?.message || e}`;
  }
}

const gainCtx = { ctx: null };
/** Apply mic gain (only when != 100%) by routing the mic through a GainNode. */
async function withGain(stream, p) {
  const t = stream.getAudioTracks()[0];
  const g = Number(p.gain ?? 100);
  if (!t || g === 100) return stream;
  const ctx = gainCtx.ctx || (gainCtx.ctx = new AudioContext({ latencyHint: "interactive" }));
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(new MediaStream([t]));
  const node = ctx.createGain(); node.gain.value = g / 100;
  const dst = ctx.createMediaStreamDestination();
  src.connect(node).connect(dst);
  const out = dst.stream.getAudioTracks()[0];
  out.addEventListener("ended", () => t.stop());
  const stopOut = out.stop.bind(out);
  out.stop = () => { stopOut(); t.stop(); };
  out.raw = t; // keep the device track for enabled/disabled and settings
  const s = new MediaStream([...stream.getVideoTracks(), out]);
  return s;
}

/** Camera controls generated from capabilities: returns an element or null. */
export function cameraControls(track) {
  track = track?.raw || track;
  if (!track || !track.getCapabilities) return null;
  let caps; try { caps = track.getCapabilities(); } catch { return null; }
  const set = track.getSettings ? track.getSettings() : {};
  const names = {
    zoom: "Zoom", focusDistance: "Enfoque", exposureCompensation: "Exposición", exposureTime: "Tiempo de exposición",
    colorTemperature: "Temperatura de color", brightness: "Brillo", contrast: "Contraste", saturation: "Saturación",
    sharpness: "Nitidez", pan: "Pan", tilt: "Tilt", iso: "ISO",
  };
  const modes = { focusMode: "Enfoque", exposureMode: "Exposición", whiteBalanceMode: "Balance de blancos" };
  const box = el("div", { class: "col camctl" });
  const apply = async (k, v) => {
    try { await track.applyConstraints({ advanced: [{ [k]: v }] }); }
    catch (e) { toast(`${names[k] || modes[k] || k}: ${e.message}`, "err"); }
  };
  for (const [k, label] of Object.entries(modes)) {
    if (!Array.isArray(caps[k]) || caps[k].length < 2) continue;
    const s = el("select", { onchange: (e) => apply(k, e.target.value) }, ...caps[k].map((m) => el("option", { value: m, text: m })));
    s.value = set[k] || caps[k][0];
    box.append(el("div", {}, el("label", { text: label }), s));
  }
  for (const [k, label] of Object.entries(names)) {
    const c = caps[k];
    if (!c || typeof c.min !== "number" || c.max <= c.min) continue;
    const r = el("input", { type: "range", min: c.min, max: c.max, step: c.step || (c.max - c.min) / 100, value: set[k] ?? c.min });
    r.oninput = () => apply(k, Number(r.value));
    box.append(el("div", {}, el("label", { text: label }), r));
  }
  for (const [k, label] of [["torch", "Linterna"], ["backgroundBlur", "Desenfocar fondo (efecto del sistema)"], ["faceFraming", "Encuadre automático"], ["eyeGazeCorrection", "Corrección de mirada"]]) {
    if (!(k in caps)) continue;
    const opts = Array.isArray(caps[k]) ? caps[k] : [true, false];
    if (!opts.includes(true)) continue;
    const cb = el("input", { type: "checkbox", checked: !!set[k], onchange: (e) => apply(k, e.target.checked) });
    box.append(el("label", { class: "row" }, cb, " " + label));
  }
  if (!box.children.length) return null;
  return el("details", { class: "camdetails" }, el("summary", { text: "🎛️ Ajustes de la cámara" }), box);
}

/**
 * Build the settings form into `root`. `onChange(prefs, what)` is called when
 * the user changes something; what is "video", "audio", "speaker" or "other".
 */
export async function renderPanel(root, prefs, onChange, opts = {}) {
  const { cams, mics, speakers } = await listDevices();
  const label = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  const sel = (id, items, value) => { const s = el("select", { id }, ...items.map(([v, t]) => el("option", { value: v, text: t }))); s.value = value; if (s.value !== value && items.length) s.selectedIndex = 0; return s; };
  const cam = sel("dev-cam", [...cams.map((d, i) => [d.deviceId, label(d, i, "Cámara")]), ["none", "🚫 Sin cámara"]], prefs.camera || cams[0]?.deviceId || "none");
  const mic = sel("dev-mic", [...mics.map((d, i) => [d.deviceId, label(d, i, "Micrófono")]), ["none", "🚫 Sin micrófono"]], prefs.mic || mics[0]?.deviceId || "none");
  const spk = canPickSpeaker() && speakers.length ? sel("dev-spk", [["", "Predeterminado del sistema"], ...speakers.filter((d) => d.deviceId !== "default").map((d, i) => [d.deviceId, label(d, i, "Salida")])], prefs.speaker || "") : null;
  const q = sel("dev-q", QUALITIES, String(prefs.quality));
  const fps = sel("dev-fps", FPS.map((f) => [f, f + " fps"]), String(prefs.fps));
  const codec = sel("dev-codec", [["", "Automático"], ["h264", "H.264 (mejor para OBS/hardware)"], ["vp8", "VP8 (máxima compatibilidad)"], ["vp9", "VP9 (mejor calidad por bit)"], ["av1", "AV1 (experimental)"]], prefs.codec || "");
  const chk = (id, text, v) => el("label", { class: "row" }, el("input", { type: "checkbox", id, checked: !!v }), " " + text);
  const gain = el("input", { type: "range", id: "dev-gain", min: 0, max: 400, step: 5, value: prefs.gain ?? 100 });
  const gainLbl = el("span", { class: "muted", text: (prefs.gain ?? 100) + "%" });
  const test = spk ? el("button", { class: "small", type: "button", text: "🔊 Probar", onclick: () => testSpeaker(spk.value) }) : null;

  root.replaceChildren(
    el("div", {}, el("label", { for: "dev-cam", text: "📷 Cámara" }), cam),
    el("div", { class: "row" }, el("div", { class: "grow" }, el("label", { text: "Resolución" }), q), el("div", {}, el("label", { text: "FPS" }), fps)),
    el("div", { class: "row wrap fliprow" }, el("span", { class: "muted", text: "Voltear la cámara (lo ven todos):" }),
      chk("dev-fliph", "↔ Horizontal", !!prefs.flipH), chk("dev-flipv", "↕ Vertical", !!prefs.flipV)),
    el("div", {}, el("label", { for: "dev-mic", text: "🎙️ Micrófono" }), mic),
    el("div", {}, el("label", { text: "Ganancia del micrófono " }, gainLbl), gain),
    spk ? el("div", {}, el("label", { for: "dev-spk", text: "🎧 Audífonos / parlantes" }), el("div", { class: "row" }, spk, test)) :
      el("p", { class: "muted", style: "margin:0;font-size:12px", text: "🎧 La salida de audio se elige en el sistema (este navegador no permite cambiarla)." }),
    opts.effects !== false ? effectsPanel(prefs, (what) => { savePrefs(prefs); onChange(prefs, what); }) : null,
    el("details", {}, el("summary", { text: "Opciones avanzadas de audio y video" }),
      el("div", { class: "col", style: "margin-top:8px" },
        chk("dev-echo", "Cancelación de eco", prefs.echo),
        chk("dev-denoise", "Supresión de ruido", prefs.denoise),
        chk("dev-agc", "Control automático de ganancia", prefs.autogain),
        chk("dev-stereo", "Audio estéreo de alta calidad (música; desactiva eco/ruido)", prefs.stereo),
        chk("dev-mirror", "Espejar mi vista previa", prefs.mirror),
        opts.codec !== false ? el("div", {}, el("label", { text: "Códec de video preferido" }), codec) : null)),
  );

  const read = () => ({
    ...prefs, camera: cam.value, mic: mic.value, speaker: spk ? spk.value : prefs.speaker, quality: q.value, fps: fps.value,
    echo: $("#dev-echo", root).checked, denoise: $("#dev-denoise", root).checked, autogain: $("#dev-agc", root).checked,
    stereo: $("#dev-stereo", root).checked, mirror: $("#dev-mirror", root).checked, gain: Number(gain.value), codec: codec.value,
    flipH: $("#dev-fliph", root).checked, flipV: $("#dev-flipv", root).checked,
  });
  const fire = (what) => { const p = read(); Object.assign(prefs, p); savePrefs(prefs); onChange(prefs, what); };
  cam.onchange = q.onchange = fps.onchange = () => fire("video");
  mic.onchange = () => fire("audio");
  gain.oninput = () => { gainLbl.textContent = gain.value + "%"; };
  gain.onchange = () => fire("audio");
  if (spk) spk.onchange = () => fire("speaker");
  $("#dev-stereo", root).onchange = (e) => {
    if (e.target.checked) for (const id of ["dev-echo", "dev-denoise", "dev-agc"]) $("#" + id, root).checked = false;
    fire("audio");
  };
  for (const id of ["dev-echo", "dev-denoise", "dev-agc"]) $("#" + id, root).onchange = () => fire("audio");
  $("#dev-mirror", root).onchange = () => fire("other");
  $("#dev-fliph", root).onchange = $("#dev-flipv", root).onchange = () => fire("video");
  codec.onchange = () => fire("other");
  return { read };
}

let testCtx;
async function testSpeaker(sinkId) {
  // A short two-tone chime through the selected output.
  testCtx = testCtx || new AudioContext();
  const dst = testCtx.createMediaStreamDestination();
  const a = new Audio(); a.srcObject = dst.stream;
  await applySink(a, sinkId);
  a.play().catch(() => {});
  [660, 880].forEach((f, i) => {
    const o = testCtx.createOscillator(), g = testCtx.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0.0001, testCtx.currentTime + i * 0.25);
    g.gain.exponentialRampToValueAtTime(0.3, testCtx.currentTime + i * 0.25 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, testCtx.currentTime + i * 0.25 + 0.24);
    o.connect(g).connect(dst); o.start(testCtx.currentTime + i * 0.25); o.stop(testCtx.currentTime + i * 0.25 + 0.25);
  });
  setTimeout(() => { a.srcObject = null; }, 900);
}

/** Re-render device lists when hardware is plugged/unplugged. */
export function onDeviceChange(fn) {
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { clearTimeout(onDeviceChange.t); onDeviceChange.t = setTimeout(fn, 400); });
}

/** Modal dialog wrapper around renderPanel. */
export function settingsDialog(title = "Ajustes de audio y video") {
  let dlg = $("#devDialog");
  if (!dlg) {
    dlg = el("dialog", { id: "devDialog", class: "card devdialog" },
      el("div", { class: "row" }, el("h3", { class: "grow", style: "margin:0", text: title }), el("button", { class: "small", onclick: () => dlg.close(), text: "✕" })),
      el("label", {}, "Tema visual ", el("select", { "data-theme-picker": "", "aria-label":"Tema visual" }, ...[["light","Día"],["dark","Noche"],["auto","Automático"]].map(([value,text])=>el("option",{value,text})))),
      el("div", { id: "devPanel", class: "col" }), el("div", { id: "devCamCtl" }));
    dlg.querySelector("[data-theme-picker]").value=document.documentElement.dataset.appearance || "auto";
    document.body.append(dlg);
  }
  return dlg;
}

// Mark our call/output tabs so a browser which ignores selfBrowserSurface can
// still identify a captured room. No room IDs, keys or participant data leave it.
const ROOM_CAPTURE_HANDLE = "streamwebrom-room-audio";
try {
  if (["/studio", "/guest", "/view"].includes(location.pathname)) navigator.mediaDevices?.setCaptureHandleConfig?.({ handle: ROOM_CAPTURE_HANDLE, permittedOrigins: [location.origin] });
} catch { /* Capture Handle is optional. */ }
const screenAudioBlocked = new WeakSet();
const nativeScreens = new WeakMap();

export function stopScreenCapture(stream) {
  if (!stream) return;
  nativeScreens.get(stream)?.cleanup(); nativeScreens.delete(stream);
  stream.getTracks().forEach(t=>t.stop());
}

// A mixed desktop loopback cannot be unmixed per listener: every participant
// would hear their voice again. Keep isolated tab audio, or system audio only
// when the browser confirms that it excludes this document's playback.
function protectScreenAudio(stream) {
  const video = stream.getVideoTracks?.()[0];
  const check = () => {
    const surface = video?.getSettings?.().displaySurface;
    const ownRoom = video?.getCaptureHandle?.()?.handle === ROOM_CAPTURE_HANDLE;
    for (const track of stream.getAudioTracks()) {
      if (!ownRoom && (nativeScreens.has(stream) || surface === "browser" || track.getSettings?.().restrictOwnAudio === true)) continue;
      screenAudioBlocked.add(stream); stream.removeTrack(track); track.stop();
    }
  };
  check();
  video?.addEventListener?.("capturehandlechange", check);
  video?.addEventListener?.("ended", () => video.removeEventListener("capturehandlechange", check), { once: true });
  return stream;
}

/** Prefer isolated tab audio; never publish an unfiltered desktop loopback. */
export async function openScreen(options = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) throw Object.assign(new Error("Este dispositivo no permite compartir pantalla."), { name: "NotSupportedError" });
  const video = { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  const audio=options.audio!==false;
  const surface=["window","monitor","browser"].includes(options.surface)?options.surface:"browser";
  const native=globalThis.window?.StreamWebRomCapture;
  // Theme selection is advisory. Do not consume the capture click's user
  // activation by waiting for a round trip to the desktop main process.
  if(native)native.preferences({theme:document.documentElement.dataset.theme}).catch(()=>{});
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { ...video, displaySurface: surface }, audio: audio ? { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      systemAudio: audio ? "include" : "exclude", windowAudio: audio ? "window" : "exclude", selfBrowserSurface: "exclude", surfaceSwitching: "exclude", preferCurrentTab: false,
    });
  } catch (e) {
    if (!["TypeError", "OverconstrainedError"].includes(e.name)) throw e;
    // Unsupported optional hints must never silently discard the requested audio.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio });
  }
  if(native)nativeScreens.set(stream,await attachNativeAudio(stream));
  if(!audio)for(const track of stream.getAudioTracks()){stream.removeTrack(track);track.stop()}
  return protectScreenAudio(stream);
}

export function screenAudioNotice(stream) {
  const native=nativeScreens.get(stream)?.selection;
  if(native&&stream.getAudioTracks().length)return native.mode==='tab'?"Pestaña compartida con su audio aislado.":"Contenido compartido con audio aislado; las voces de la sala quedan fuera de la captura.";
  if (screenAudioBlocked.has(stream)) return "Vídeo compartido. Este navegador no pudo aislar las voces del audio general; usa Captura avanzada en PC para compartir esta aplicación o el sistema con sonido.";
  return stream.getAudioTracks().length ? "Pantalla compartida con audio de la fuente, sin mezclar el sonido de la sala." : "La pantalla no incluye audio. Para enviarlo sin eco, comparte otra pestaña y marca «Compartir audio de la pestaña».";
}

export function resumeCaptureAudio() {
  if (gainCtx.ctx && gainCtx.ctx.state !== "running") gainCtx.ctx.resume().catch(() => {});
}

// Audio graphs created before a user gesture start suspended: wake them on the first click.
for (const ev of ["pointerdown", "keydown"]) {
  document.addEventListener(ev, () => { if (gainCtx.ctx && gainCtx.ctx.state === "suspended") gainCtx.ctx.resume().catch(() => {}); }, { capture: true });
}
