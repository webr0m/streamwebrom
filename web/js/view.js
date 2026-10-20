// Clean output for OBS Browser Source / vMix / any browser.
//   /view?room=R&scene=1#key=VIEWKEY            full program (layout, brand, banners)
//   /view?room=R&scene=1&transparent=1#key=...  same, transparent background
//   /view?room=R&scene=2#key=...                extra scene 2..8 (its own lineup/layout, VDO.Ninja "add to scene")
//   /view?room=R&stream=ID#key=...              one source, full frame
// Optional (VDO.Ninja-style):
//   &cover=0 show the entire source (default: centered 16:9 camera crop) · &mute=1 / &noaudio no sound · &volume=0..100
//   &label=1 show the name · &mirror=1 · &rotate=90|180|270 · &bg=#hex
//   &audioonly=1 sound only · &status=0 hide status text · &transparent=1
//   &stats=1 show resolution / fps / bitrate overlay
import { $, params, hashParams, Signal, subscribe } from "./rtc.js";
import { singleOutput } from "./output-quality.js";
import { watchConnection } from "./connection-health.js";
import { Compositor, programGain } from "./compositor.js";
import { needsOutputSource } from "./bandwidth.js";

const room = (params.get("room") || "").toLowerCase();
const key = hashParams.get("key") || params.get("key") || "";
const only = params.get("stream");
const scene = params.has("scene") || !only;
const sceneName = (params.get("scene") || "1").toLowerCase();
// Scene 1 (or bare &scene) is the program; other names come from state.outputs.
const view = () => sceneName === "1" || sceneName === "" || sceneName === "0" ? state
  : { ...state, stage: [], layout: "grid", featured: "", ...((state.outputs || {})[sceneName] || {}) };
const muted = params.get("mute") === "1" || params.has("noaudio") || params.has("na");
const baseVol = (() => { const v = Number(params.get("volume") ?? params.get("vol") ?? 100); return Math.max(0, Math.min(1, v > 1 ? v / 100 : v)); })();
const audioOnly = params.has("audioonly") || params.has("ao");
if (params.get("transparent") === "1") document.body.classList.add("transparent");
if (params.get("bg")) document.body.style.background = /^#?[0-9a-f]{3,8}$/i.test(params.get("bg")) ? "#" + params.get("bg").replace("#", "") : "";
const single = $("#single");
if (params.get("mirror") === "1") single.style.transform = "scaleX(-1)";
const rot = Number(params.get("rotate"));
if ([90, 180, 270].includes(rot)) single.style.transform = (single.style.transform || "") + ` rotate(${rot}deg)`;
if (audioOnly) single.style.visibility = "hidden";
const framing = kind => document.body.classList.toggle("contain", params.get("cover") === "0" || (params.get("cover") !== "1" && kind === "screen"));
framing();
const status = $("#status");
const say = (t) => { status.textContent = t; status.classList.toggle("hidden", !t || params.get("status") === "0"); };

let state = {};
const sources = new Map();
const audios = new Map();
const available = new Map();
const retries = new Map();
let statsTimer;
const sig = new Signal();
let compositor, output, switching = false, triedLocal = false;
const explicitRoute = params.has("network");
const configureRoute = () => {
  if (!explicitRoute && !triedLocal) sig.mediaMode = sig.relayProvider === "cloudflare" ? "auto" : sig.ice.some(s => [s.urls].flat().some(u => /^turns:.*:443(?:\?|$)/i.test(u))) ? "tls" : "auto";
};
const needed = info => needsOutputSource(info, state, only, sceneName);
if (only && params.has("quality")) {
  const canvas = $("#singleOut"); canvas.classList.remove("hidden");
  single.classList.add("output-input"); canvas.style.transform = single.style.transform;
  output = singleOutput(canvas, single, params.get("quality"), params.get("fps"), () => document.body.classList.contains("contain"));
}
async function recover(info, entry) {
  if (sources.get(info.id) !== entry) return;
  sources.delete(info.id); entry.stopWatch?.(); clearTimeout(entry.frameTimer); entry.sub?.close(); entry.video.srcObject = null;
  const audio = audios.get(info.id); if (audio) { audio.pause(); audio.srcObject = null; audios.delete(info.id); }
  if (!explicitRoute && !triedLocal && sig.localIce.length && !switching) {
    switching = true; triedLocal = true; sig.mediaMode = "local"; say("probando conexión alternativa…");
    try { await sig.reconnect(); } catch { say("esperando conexión…"); } finally { switching = false; }
    return;
  }
  say("esperando señal…");
  clearTimeout(retries.get(info.id));
  retries.set(info.id, setTimeout(() => { retries.delete(info.id); if (available.has(info.id)) watch(available.get(info.id)); }, 1000));
}

function playAudio(id, stream) {
  if (muted || audios.has(id)) return;
  const a = new Audio();
  a.srcObject = stream; a.autoplay = true;
  a.play().catch(() => {});
  audios.set(id, a);
}

function syncAudio() {
  // Only what is on stage is audible in the program, exactly like the studio mix.
  for (const [id, a] of audios) {
    a.muted = scene && !(view().stage || []).includes(id);
    a.volume = Math.min(1, baseVol * (scene ? programGain(view(), id) : 1));
  }
  if (only) single.volume = baseVol;
}

async function watch(info) {
  if (!available.has(info.id)) return;
  if (!needed(info)) return;
  if (info.kind === "program" && scene) return;
  if (only && info.id !== only) return;
  if (sources.has(info.id)) return;
  const v = only ? single : document.createElement("video");
  v.muted = true; v.playsInline = true; v.autoplay = true;
  const entry = { video: v, kind: info.kind, name: info.id, stream: null };
  sources.set(info.id, entry);
  try {
    const sub = await subscribe(sig, info.id, { timeout: 10000 });
    if (sources.get(info.id) !== entry) { sub.close(); return; }
    entry.stream = sub.stream; entry.sub = sub; entry.name = sub.name || info.id;
    v.srcObject = sub.stream;
    v.play().catch(() => {});
    if (only) {
      framing(info.kind);
      const s = $("#single");
      s.srcObject = sub.stream; s.muted = muted; s.volume = baseVol; s.classList.remove("hidden");
      if (params.get("label") === "1" || params.has("showlabel")) $("#label").textContent = sub.name || "";
      if (params.get("stats") === "1") startStats(sub.pc);
      s.play().catch(() => { s.muted = true; s.play().catch(() => {}); });
    } else playAudio(info.id, sub.stream);
    entry.stopWatch = watchConnection(sub.pc, () => recover(info, entry));
    entry.frameTimer = setTimeout(() => {
      if (v.readyState < 2 && sub.stream.getVideoTracks().length) recover(info, entry);
    }, 8000);
    syncAudio();
    say("");
  } catch { await recover(info, entry); }
}

function resetMedia() {
  clearInterval(statsTimer);
  for (const timer of retries.values()) clearTimeout(timer);
  retries.clear(); available.clear();
  for (const source of sources.values()) { source.stopWatch?.(); clearTimeout(source.frameTimer); source.sub?.close(); source.video.srcObject = null; }
  sources.clear();
  for (const audio of audios.values()) { audio.pause(); audio.srcObject = null; audio.remove(); }
  audios.clear(); single.srcObject = null;
}
function discard(id) {
  clearTimeout(retries.get(id)); retries.delete(id);
  const s = sources.get(id); s?.stopWatch?.(); clearTimeout(s?.frameTimer); s?.sub?.close(); if (s) s.video.srcObject = null; sources.delete(id);
  const audio = audios.get(id); if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); audios.delete(id); }
}
function syncSubscriptions() {
  for (const [id] of sources) if (!available.has(id) || !needed(available.get(id))) discard(id);
  for (const info of available.values()) if (needed(info)) watch(info);
}
function discover(streams) { for (const info of streams || []) available.set(info.id, info); syncSubscriptions(); }

sig.on("state", (m) => { state = m.state; syncSubscriptions(); syncAudio(); });
sig.on("stream-added", (m) => discover([m.info]));
sig.on("stream-removed", (m) => {
  available.delete(m.stream); clearTimeout(retries.get(m.stream)); retries.delete(m.stream);
  const s = sources.get(m.stream); s?.stopWatch?.(); clearTimeout(s?.frameTimer); s?.sub?.close(); if (s) s.video.srcObject = null; sources.delete(m.stream);
  const audio = audios.get(m.stream); if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); } audios.delete(m.stream);
  if (only === m.stream) { clearInterval(statsTimer); single.srcObject = null; say("señal perdida, reintentando…"); }
});
sig.on("disconnected", () => { resetMedia(); say("reconectando…"); });
sig.on("reconnected", (m) => { state = m.state; configureRoute(); discover(m.streams); syncAudio(); });

sig.connect({ type: "join", room, role: "viewer", key, name: "OBS" })
  .then((m) => {
    state = m.state; configureRoute();
    if (scene && !only) {
      const c = $("#out");
      c.classList.remove("hidden");
      compositor = new Compositor(c, sources, view, { transparent: params.get("transparent") === "1", height: params.get("quality"), fps: params.get("fps") }); compositor.start();
    }
    discover(m.streams);
    say(only ? "esperando señal…" : "");
  })
  .catch((e) => say("error: " + e.message));

function startStats(pc) {
  clearInterval(statsTimer);
  const box = $("#stats");
  box.classList.remove("hidden");
  let last = null;
  statsTimer = setInterval(async () => {
    if (pc.connectionState === "closed") return;
    const r = await pc.getStats();
    r.forEach((x) => {
      if (x.type !== "inbound-rtp" || x.kind !== "video") return;
      const kbps = last ? Math.round(((x.bytesReceived - last.bytesReceived) * 8) / ((x.timestamp - last.timestamp) || 1)) : 0;
      box.textContent = `${x.frameWidth || "?"}×${x.frameHeight || "?"} · ${Math.round(x.framesPerSecond || 0)} fps · ${kbps} kbps · perdidos ${x.packetsLost || 0}`;
      last = x;
    });
  }, 1000);
}

window.addEventListener("pagehide", () => { sig.close(); resetMedia(); compositor?.stop(); output?.stop(); });

// Double-click = full screen (handy for the "pantalla virtual" window on a projector or second monitor).
document.addEventListener("dblclick", () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen(); });
