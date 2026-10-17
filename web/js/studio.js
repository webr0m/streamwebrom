import { $, $$, el, toast, copy, params, hashParams, api, Signal, publish, subscribe, levelMeter, fmtTime } from "./rtc.js";
import { Compositor, AudioMixer } from "./compositor.js";

const room = (params.get("room") || "").toLowerCase();
const savedRooms = JSON.parse(localStorage.getItem("swr.rooms") || "{}");
const hostKey = hashParams.get("key") || savedRooms[room]?.hostKey;
if (!room || !hostKey) { alert("Falta la sala o la clave de anfitrión. Crea un estudio desde la portada."); location.href = "/"; }
// Remember the key locally and scrub it from the address bar (screenshots, screen shares).
savedRooms[room] = { ...(savedRooms[room] || {}), room, hostKey, created: savedRooms[room]?.created || Date.now() };
localStorage.setItem("swr.rooms", JSON.stringify(savedRooms));
history.replaceState(null, "", `/studio?room=${encodeURIComponent(room)}`);

const LAYOUTS = [["solo", "Solo"], ["split", "Dividido"], ["grid", "Cuadrícula"], ["pip", "PiP"], ["sidebar", "Lateral"], ["spotlight", "Destacado"], ["screen", "Pantalla"], ["news", "Noticiero"]];

let state = {};
let keys = {};
let peers = new Map();       // peerId -> info
const sources = new Map();   // streamId -> { video, stream, name, kind, level, owner, sub }
const local = new Map();     // streamId -> publication (host's own)
const sig = new Signal();
let program = null;          // publication of the composed program
let liveSince = 0;

// ---------- program preview ----------
const comp = new Compositor($("#program"), sources, () => state);
comp.start();
const mixer = new AudioMixer();

// ---------- connection ----------
function setStatus(t, cls = "") { const s = $("#status"); s.textContent = t; s.className = "pill " + cls; }

sig.on("disconnected", () => setStatus("reconectando…", "red"));
sig.on("reconnected", (m) => { onWelcome(m); setStatus("conectado", "green"); });

function onWelcome(m) {
  state = m.state; keys = m.keys || keys;
  peers = new Map((m.peers || []).map((p) => [p.id, p]));
  for (const s of m.streams || []) addRemote(s.id, s.kind, s.owner);
  for (const c of m.chat || []) addChat(c);
  renderAll();
}

sig.connect({ type: "join", room, role: "host", key: hostKey, name: "Anfitrión" })
  .then((m) => { onWelcome(m); setStatus("conectado", "green"); })
  .catch((e) => { setStatus("error", "red"); toast("No se pudo entrar: " + e.message, "err"); });

sig.on("state", (m) => { state = m.state; renderState(); });
sig.on("peer-joined", (m) => { peers.set(m.peer.id, m.peer); renderPeople(); toast(`${m.peer.name} entró`); });
sig.on("peer-updated", (m) => { peers.set(m.peer.id, m.peer); renderPeople(); renderBackstage(); });
sig.on("peer-left", (m) => { const p = peers.get(m.peerId); peers.delete(m.peerId); renderPeople(); if (p) toast(`${p.name} salió`); });
sig.on("stream-added", (m) => addRemote(m.info.id, m.info.kind, m.info.owner, m.name));
sig.on("stream-removed", (m) => removeSource(m.stream));
sig.on("chat", (m) => addChat(m.comment));
sig.on("knock", (m) => addKnock(m));
sig.on("reaction", (m) => flyReaction(m.text));
sig.on("restream", (m) => { const r = m.state.restream; $("#restreamStats").textContent = r ? (r.stats || "") + (r.lastError ? " · " + r.lastError : "") : ""; });
sig.on("error", (m) => toast(m.error, "err"));

async function addRemote(id, kind, owner, name) {
  if (sources.has(id) || local.has(id) || kind === "program") return;
  const placeholder = { kind, owner, name: name || id, video: document.createElement("video"), stream: null, level: () => 0 };
  sources.set(id, placeholder);
  try {
    const sub = await subscribe(sig, id);
    const v = placeholder.video;
    v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = sub.stream;
    await v.play().catch(() => {});
    Object.assign(placeholder, { stream: sub.stream, sub, name: sub.name || placeholder.name });
    setTimeout(() => { if (sub.stream.getAudioTracks().length) placeholder.level = levelMeter(sub.stream); syncAudio(); }, 300);
    renderBackstage();
  } catch (e) {
    sources.delete(id);
    console.warn("subscribe", id, e);
  }
}

function removeSource(id) {
  const s = sources.get(id);
  if (!s) return;
  s.sub?.close();
  sources.delete(id);
  renderBackstage();
  syncAudio();
}

// ---------- host's own sources ----------
async function addLocal(media, kind, name) {
  try {
    const pub = await publish(sig, media, { kind, name, videoKbps: kind === "screen" ? 6000 : 4000, contentHint: kind === "screen" ? "detail" : "motion" });
    const v = el("video", { muted: true, playsinline: true, autoplay: true });
    v.muted = true; v.srcObject = media; v.play().catch(() => {});
    sources.set(pub.id, { video: v, stream: media, name, kind, owner: "me", level: levelMeter(media), local: true });
    local.set(pub.id, pub);
    media.getVideoTracks()[0]?.addEventListener("ended", () => stopLocal(pub.id));
    renderBackstage();
    return pub.id;
  } catch (e) { toast(e.message, "err"); media.getTracks().forEach((t) => t.stop()); }
}

function stopLocal(id) {
  const pub = local.get(id), s = sources.get(id);
  if (!pub) return;
  pub.stop();
  s?.stream.getTracks().forEach((t) => t.stop());
  local.delete(id); sources.delete(id);
  setState({ stage: (state.stage || []).filter((x) => x !== id) });
  renderBackstage();
}

$("#addCam").onclick = async () => {
  try {
    const m = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const id = await addLocal(m, "camera", "Anfitrión");
    if (id) setState({ stage: [...(state.stage || []), id] });
  } catch (e) { toast("Cámara: " + e.message, "err"); }
};
$("#addScreen").onclick = async () => {
  try {
    const m = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: 1920, height: 1080 }, audio: true });
    const id = await addLocal(m, "screen", "Pantalla");
    if (id) setState({ stage: [...(state.stage || []), id], layout: "screen" });
  } catch (e) { if (e.name !== "NotAllowedError") toast("Pantalla: " + e.message, "err"); }
};
$("#addMedia").onclick = () => $("#mediaFile").click();
$("#mediaFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  let media;
  if (f.type.startsWith("image/")) {
    const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
    const c = el("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    setInterval(() => ctx.drawImage(img, 0, 0), 500);
    ctx.drawImage(img, 0, 0);
    media = c.captureStream(2);
  } else {
    const v = el("video", { loop: true, playsinline: true }); v.src = URL.createObjectURL(f);
    await v.play();
    media = v.captureStream ? v.captureStream() : v.mozCaptureStream();
  }
  await addLocal(media, "media", f.name.replace(/\.[^.]+$/, "").slice(0, 40));
  e.target.value = "";
};

// ---------- state helpers ----------
function setState(patch) { sig.send({ type: "state", value: patch }); }
const onStage = (id) => (state.stage || []).includes(id);
function toggleStage(id) {
  const stage = state.stage || [];
  setState({ stage: onStage(id) ? stage.filter((x) => x !== id) : [...stage, id] });
}

function syncAudio() { mixer.sync((state.stage || []).filter((id) => sources.has(id)), sources); }

// ---------- rendering ----------
function renderAll() { renderState(); renderBackstage(); renderPeople(); renderObs(); }

function renderState() {
  $("#title").textContent = state.title || room;
  document.title = (state.title || room) + " · StreamWebRom";
  $("#showTitle").value = state.title || "";
  $("#lobbyToggle").checked = !!state.lobby;
  $$("#layouts button").forEach((b) => b.classList.toggle("active", b.dataset.l === state.layout));
  const live = !!state.live;
  $("#golive").textContent = live ? "■ Terminar" : "● Transmitir";
  $("#golive").className = live ? "live" : "primary";
  $("#liveBadge").classList.toggle("hidden", !live);
  if (live && !liveSince) liveSince = (state.restream?.since || Date.now() / 1000) * 1000;
  if (!live) liveSince = 0;
  const rec = (state.recording || []).length > 0;
  $("#record").textContent = rec ? "■ Detener grabación" : "⏺️ Grabar";
  $("#record").className = rec ? "danger" : "";
  const b = state.brand || {};
  $("#brandColor").value = b.color || "#7c5cff";
  $("#brandTheme").value = b.theme || "bubble";
  if (document.activeElement !== $("#brandBg")) $("#brandBg").value = b.background || "";
  $("#brandNames").checked = b.showNames !== false;
  renderBackstage(); renderBanners(); renderScenes(); syncAudio();
}

function renderBackstage() {
  const box = $("#backstage");
  box.replaceChildren();
  if (!sources.size) box.append(el("p", { class: "muted", text: "Aún no hay fuentes. Invita gente o agrega tu cámara/pantalla." }));
  for (const [id, s] of sources) {
    const owner = peers.get(s.owner);
    const v = el("video", { muted: true, playsinline: true, autoplay: true });
    v.muted = true; v.srcObject = s.stream; v.play().catch(() => {});
    const tile = el("div", { class: "tile" + (onStage(id) ? " stage" : ""), "data-id": id },
      v,
      owner?.hand ? el("span", { class: "hand", text: "✋" }) : null,
      el("span", { class: "name", text: (state.labels && state.labels[id]) || s.name + (s.kind === "screen" ? " · pantalla" : "") }),
      el("div", { class: "tools" },
        el("button", { class: onStage(id) ? "on" : "", onclick: () => toggleStage(id), text: onStage(id) ? "Quitar" : "Al escenario" }),
        el("button", { title: "Destacar", onclick: () => setState({ featured: state.featured === id ? "" : id }), text: state.featured === id ? "★" : "☆" }),
        el("button", { title: "Renombrar", onclick: () => rename(id, s), text: "✎" }),
        s.local ? el("button", { title: "Detener", onclick: () => stopLocal(id), text: "✕" }) :
          el("button", { title: "Silenciar", onclick: () => sig.send({ type: "request", target: s.owner, action: "mute" }), text: "🔇" })));
    box.append(tile);
  }
}

function rename(id, s) {
  const n = prompt("Nombre / título en pantalla", (state.labels && state.labels[id]) || s.name);
  if (n == null) return;
  setState({ labels: { ...(state.labels || {}), [id]: n.trim() } });
}

function renderPeople() {
  const box = $("#people");
  box.replaceChildren();
  for (const p of peers.values()) {
    if (p.role === "host") continue;
    box.append(el("div", { class: "item" },
      el("span", { class: "grow", text: `${p.hand ? "✋ " : ""}${p.name}` }),
      el("span", { class: "pill", text: (p.mic ? "🎙️" : "🔇") + (p.cam ? " 📷" : "") }),
      el("button", { class: "small", onclick: () => sig.send({ type: "request", target: p.id, action: p.mic ? "mute" : "unmute" }), text: p.mic ? "Silenciar" : "Pedir audio" }),
      el("button", { class: "small danger", onclick: () => confirm(`¿Expulsar a ${p.name}?`) && sig.send({ type: "kick", target: p.id }), text: "Expulsar" })));
  }
  if (!box.children.length) box.append(el("p", { class: "muted", text: "Nadie más todavía." }));
}

function addKnock(m) {
  toast(`${m.name} quiere entrar`);
  const it = el("div", { class: "item" }, el("span", { class: "grow", text: "🚪 " + m.name }),
    el("button", { class: "small primary", onclick: () => { sig.send({ type: "admit", target: m.peerId }); it.remove(); }, text: "Admitir" }),
    el("button", { class: "small", onclick: () => { sig.send({ type: "deny", target: m.peerId }); it.remove(); }, text: "Rechazar" }));
  $("#knocks").append(it);
  activateTab("people");
}

// ---------- layouts ----------
LAYOUTS.forEach(([l, label], i) => $("#layouts").append(el("button", { "data-l": l, title: `${label} (${i + 1})`, onclick: () => setState({ layout: l }), text: label })));
$("#countdown").onclick = () => setState({ countdown: state.countdown > Date.now() ? 0 : Date.now() + 5 * 60 * 1000 });
$("#clearScreen").onclick = () => setState({ banner: null, comment: null });
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= LAYOUTS.length) setState({ layout: LAYOUTS[n - 1][0] });
  if (e.key === "c") setState({ banner: null, comment: null });
  if (e.key === "b" && state.banners?.length) setState({ banner: state.banner ? null : state.banners[0] });
});

// ---------- chat ----------
function addChat(c) {
  const box = $("#chatlog");
  const msg = el("div", { class: "msg" },
    el("button", { class: "small act", title: "Mostrar en pantalla", onclick: () => setState({ comment: state.comment?.id === c.id ? null : c }), text: "📺" }),
    el("b", { text: c.from }), " ", el("span", { text: c.text }));
  box.append(msg);
  box.scrollTop = box.scrollHeight;
}
const sendChat = () => { const i = $("#chatInput"); if (i.value.trim()) sig.send({ type: "chat", text: i.value }); i.value = ""; };
$("#chatSend").onclick = sendChat;
$("#chatInput").addEventListener("keydown", (e) => e.key === "Enter" && sendChat());

// ---------- banners ----------
$("#bannerAdd").onclick = () => {
  const text = $("#bannerText").value.trim();
  if (!text) return;
  setState({ banners: [...(state.banners || []), { id: crypto.randomUUID().slice(0, 8), text, ticker: $("#bannerTicker").checked }] });
  $("#bannerText").value = "";
};
function renderBanners() {
  const box = $("#bannerList");
  box.replaceChildren();
  for (const b of state.banners || []) {
    const active = state.banner?.id === b.id;
    box.append(el("div", { class: "item" },
      el("span", { class: "grow", text: (b.ticker ? "↔ " : "") + b.text }),
      el("button", { class: "small " + (active ? "on" : ""), onclick: () => setState({ banner: active ? null : b }), text: active ? "Ocultar" : "Mostrar" }),
      el("button", { class: "small", onclick: () => setState({ banners: state.banners.filter((x) => x.id !== b.id), ...(active ? { banner: null } : {}) }), text: "✕" })));
  }
}

// ---------- brand ----------
const readFile = (f, max) => new Promise((res, rej) => {
  if (f.size > max) return rej(new Error(`archivo muy grande (máx ${Math.round(max / 1024)} KB)`));
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
});
let pendingLogo, pendingOverlay;
$("#brandLogo").onchange = async (e) => { try { pendingLogo = await readFile(e.target.files[0], 400 * 1024); } catch (x) { toast(x.message, "err"); } };
$("#brandOverlay").onchange = async (e) => { try { pendingOverlay = await readFile(e.target.files[0], 1536 * 1024); } catch (x) { toast(x.message, "err"); } };
$("#brandClearLogo").onclick = () => setState({ brand: { ...state.brand, logo: "" } });
$("#brandClearOverlay").onclick = () => setState({ brand: { ...state.brand, overlay: "" } });
$("#brandSave").onclick = () => {
  const b = { ...(state.brand || {}), color: $("#brandColor").value, theme: $("#brandTheme").value, background: $("#brandBg").value.trim() || "#0b0b12", showNames: $("#brandNames").checked };
  if (pendingLogo) b.logo = pendingLogo;
  if (pendingOverlay) b.overlay = pendingOverlay;
  pendingLogo = pendingOverlay = null;
  setState({ brand: b });
  toast("Marca aplicada", "ok");
};
$("#titleSave").onclick = () => setState({ title: $("#showTitle").value.trim() });
$("#lobbyToggle").onchange = (e) => setState({ lobby: e.target.checked });

// ---------- scenes ----------
$("#sceneSave").onclick = () => {
  const name = $("#sceneName").value.trim() || `Escena ${Object.keys(state.scenes || {}).length + 1}`;
  setState({ scenes: { ...(state.scenes || {}), [name]: { layout: state.layout, stage: state.stage || [], banner: state.banner || null } } });
  $("#sceneName").value = "";
};
function renderScenes() {
  const box = $("#sceneList");
  box.replaceChildren();
  for (const [name, sc] of Object.entries(state.scenes || {})) {
    box.append(el("div", { class: "item" },
      el("span", { class: "grow", text: `${name} · ${sc.layout} · ${sc.stage.length}` }),
      el("button", { class: "small primary", onclick: () => setState({ layout: sc.layout, stage: sc.stage.filter((id) => sources.has(id)), banner: sc.banner }), text: "Cargar" }),
      el("button", { class: "small", onclick: () => { const s = { ...state.scenes }; delete s[name]; setState({ scenes: s }); }, text: "✕" })));
  }
}

// ---------- destinations (kept in localStorage only) ----------
const destKey = `swr.dest.${room}`;
let dests = JSON.parse(localStorage.getItem(destKey) || localStorage.getItem("swr.dest") || "[]");
const saveDests = () => { localStorage.setItem(destKey, JSON.stringify(dests)); localStorage.setItem("swr.dest", JSON.stringify(dests)); renderDests(); };
$("#destPreset").onchange = (e) => { $("#destURL").value = e.target.value; };
$("#destURL").value = $("#destPreset").value;
$("#destAdd").onclick = () => {
  const base = $("#destURL").value.trim(), key = $("#destKey").value.trim();
  if (!/^(rtmps?|srt):\/\//.test(base)) return toast("La URL debe empezar con rtmp://, rtmps:// o srt://", "err");
  const url = key ? base.replace(/\/?$/, "/") + key : base;
  dests.push({ name: $("#destPreset").selectedOptions[0].textContent.split(" ")[0], url, enabled: true });
  $("#destKey").value = "";
  saveDests();
};
function renderDests() {
  const box = $("#destList");
  box.replaceChildren();
  dests.forEach((d, i) => box.append(el("div", { class: "item" },
    el("input", { type: "checkbox", checked: d.enabled, onchange: (e) => { d.enabled = e.target.checked; saveDests(); } }),
    el("span", { class: "grow", text: `${d.name} · ${d.url.replace(/\/[^/]{6,}$/, "/••••")}` }),
    el("button", { class: "small", onclick: () => { dests.splice(i, 1); saveDests(); }, text: "✕" }))));
  if (!dests.length) box.append(el("p", { class: "muted", text: "Sin destinos. También puedes capturar el programa en OBS desde la pestaña OBS." }));
}
renderDests();

// ---------- program publish + go live ----------
async function ensureProgram() {
  if (program) return program;
  const video = $("#program").captureStream(Number($("#fps").value) || 30);
  const media = new MediaStream([...video.getVideoTracks(), mixer.track]);
  program = await publish(sig, media, { kind: "program", stream: "program", name: "Programa", videoKbps: Number($("#vKbps").value) || 4500, audioKbps: 160, codec: "video/H264", fps: Number($("#fps").value) || 30 });
  return program;
}

$("#golive").onclick = async () => {
  if (state.live) {
    if (!confirm("¿Terminar la transmisión?")) return;
    sig.send({ type: "endlive" });
    return;
  }
  const active = dests.filter((d) => d.enabled);
  if (!active.length) { activateTab("dest"); return toast("Agrega al menos un destino", "err"); }
  $("#golive").disabled = true;
  try {
    await ensureProgram();
    await new Promise((r) => setTimeout(r, 1200));
    await sig.request({ type: "golive", stream: "program", dests: active.map(({ name, url }) => ({ name, url })), settings: { videoKbps: Number($("#vKbps").value) || 4500, fps: Number($("#fps").value) || 30, audioKbps: 160 } });
    toast("¡Estás en vivo!", "ok");
  } catch (e) { toast("No se pudo transmitir: " + e.message, "err"); }
  $("#golive").disabled = false;
};

$("#record").onclick = () => {
  const rec = (state.recording || []).length > 0;
  sig.send({ type: "record", action: rec ? "stop" : "start", stream: "*" });
  toast(rec ? "Grabación detenida; archivos en la carpeta de datos del servidor." : "Grabando cada fuente por separado", "ok");
};

setInterval(() => {
  const t = $("#liveTimer");
  t.classList.toggle("hidden", !liveSince);
  if (liveSince) t.textContent = "⏱ " + fmtTime(Date.now() - liveSince);
}, 1000);

// ---------- invite & OBS links ----------
const origin = () => location.origin;
$("#invite").onclick = () => copy(`${origin()}/guest?room=${encodeURIComponent(room)}`);

function linkRow(label, value) {
  const i = el("input", { readonly: true, value });
  return el("div", {}, el("label", { text: label }), el("div", { class: "copy" }, i, el("button", { class: "small", onclick: () => copy(value), text: "Copiar" })));
}
function renderObs() {
  if (!keys.viewKey) return;
  const vk = encodeURIComponent(keys.viewKey), r = encodeURIComponent(room);
  const box = $("#obsLinks");
  box.replaceChildren(
    linkRow("Programa completo (escena, con banners y marca)", `${origin()}/view?room=${r}&scene=1#key=${vk}`),
    linkRow("Programa con fondo transparente (para tus propias escenas)", `${origin()}/view?room=${r}&scene=1&transparent=1#key=${vk}`),
    linkRow("Invitación para invitados", `${origin()}/guest?room=${r}`),
    linkRow("WHEP del programa (reproductores WHEP / OBS 31+)", `${origin()}/whep/${r}/program`),
    linkRow("Clave WHEP (Bearer)", keys.viewKey),
  );
  for (const [id, s] of sources) if (!s.local) box.append(linkRow(`Solo ${s.name}`, `${origin()}/view?room=${r}&stream=${encodeURIComponent(id)}#key=${vk}`));
  $("#whipLinks").replaceChildren(
    linkRow("Servidor WHIP", `${origin()}/whip/${r}/obs`),
    linkRow("Bearer Token", keys.pushKey));
}
setInterval(() => { if ($('[data-pane="obs"]').classList.contains("active")) renderObs(); }, 3000);

// ---------- tabs & misc ----------
function activateTab(name) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  if (name === "obs") renderObs();
}
$$("#tabs button").forEach((b) => (b.onclick = () => activateTab(b.dataset.tab)));

function flyReaction(e) {
  const n = el("div", { class: "reaction-fly", text: e });
  n.style.left = 20 + Math.random() * 60 + "vw";
  document.body.append(n);
  setTimeout(() => n.remove(), 2500);
}

window.addEventListener("beforeunload", (e) => { if (state.live) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("click", () => mixer.ctx.resume(), { once: true });
api(`/api/rooms/${encodeURIComponent(room)}`).catch(() => {});
