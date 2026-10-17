// Clean output for OBS Browser Source / vMix / any browser.
//   /view?room=R&scene=1#key=VIEWKEY            full program (layout, brand, banners)
//   /view?room=R&scene=1&transparent=1#key=...  same, transparent background
//   /view?room=R&stream=ID#key=...              one source, full frame
// Optional: &cover=1 (crop to fill), &mute=1, &status=0
import { $, params, hashParams, Signal, subscribe } from "./rtc.js";
import { Compositor } from "./compositor.js";

const room = (params.get("room") || "").toLowerCase();
const key = hashParams.get("key") || params.get("key") || "";
const only = params.get("stream");
const scene = params.has("scene") || !only;
const muted = params.get("mute") === "1";
if (params.get("cover") === "1") document.body.classList.add("cover");
const status = $("#status");
const say = (t) => { status.textContent = t; status.classList.toggle("hidden", !t || params.get("status") === "0"); };

let state = {};
const sources = new Map();
const audios = new Map();
const sig = new Signal();

function playAudio(id, stream) {
  if (muted || audios.has(id)) return;
  const a = new Audio();
  a.srcObject = stream; a.autoplay = true;
  a.play().catch(() => {});
  audios.set(id, a);
}

function syncAudio() {
  // Only what is on stage is audible in the program, exactly like the studio mix.
  for (const [id, a] of audios) a.muted = scene && !(state.stage || []).includes(id);
}

async function watch(info) {
  if (info.kind === "program" && scene) return;
  if (only && info.id !== only) return;
  if (sources.has(info.id)) return;
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.autoplay = true;
  const entry = { video: v, kind: info.kind, name: info.id, stream: null };
  sources.set(info.id, entry);
  try {
    const sub = await subscribe(sig, info.id);
    entry.stream = sub.stream; entry.sub = sub; entry.name = sub.name || info.id;
    v.srcObject = sub.stream;
    await v.play().catch(() => {});
    if (only) {
      const s = $("#single");
      s.srcObject = sub.stream; s.muted = muted; s.classList.remove("hidden");
      s.play().catch(() => { s.muted = true; s.play(); });
    } else playAudio(info.id, sub.stream);
    syncAudio();
    say("");
  } catch (e) { sources.delete(info.id); say("esperando señal…"); setTimeout(() => watch(info), 2000); }
}

sig.on("state", (m) => { state = m.state; syncAudio(); });
sig.on("stream-added", (m) => watch(m.info));
sig.on("stream-removed", (m) => { const s = sources.get(m.stream); s?.sub?.close(); sources.delete(m.stream); audios.get(m.stream)?.remove(); audios.delete(m.stream); if (only === m.stream) say("señal perdida, reintentando…"); });
sig.on("disconnected", () => say("reconectando…"));
sig.on("reconnected", (m) => { state = m.state; (m.streams || []).forEach(watch); });

sig.connect({ type: "join", room, role: "viewer", key, name: "OBS" })
  .then((m) => {
    state = m.state;
    if (scene && !only) {
      const c = $("#out");
      c.classList.remove("hidden");
      new Compositor(c, sources, () => state, { transparent: params.get("transparent") === "1" }).start();
    }
    (m.streams || []).forEach(watch);
    say(only ? "esperando señal…" : "");
  })
  .catch((e) => say("error: " + e.message));
