import { workspace } from "./workspace.js";
import { $, $$, el, toast, copy, params, hashParams, api, Signal, publish, subscribe, levelMeter, fmtTime, readStored, writeStored, staleRevision } from "./rtc.js";
import { roomTelemetry, metricText } from "./telemetry.js";
import { relayMonitor } from "./relay-status.js";
import { mountVdo } from "./vdo.js";
import { immersive } from "./immersive.js";
import { Compositor, AudioMixer } from "./compositor.js";
import { chatMessage, appendChat, mountComposer } from "./chat.js";
import { listDevices, openScreen, loadPrefs, openMedia, renderPanel, cameraControls, applySink, onDeviceChange, settingsDialog, kbpsFor, explain, QUALITIES, FPS } from "./devices.js";
import { screenAudioNotice, stopScreenCapture } from "./devices.js";
import { chooseScreen } from "./screen-share.js";
import { RoomAudio } from "./room-audio.js";

const prefs = loadPrefs();
const studioWorkspace = workspace(document.querySelector("#studioRoot"));
let hostCamId = "";         // stream id of the host's main camera (hot-swappable)
let monitorOn = true;
try { monitorOn = localStorage.getItem("swr.monitor") !== "0"; } catch {}
const monitors = new Map(); // streamId -> <audio> for the host's headphones
const roomAudio = new RoomAudio();
const remoteInfo = new Map(), remoteRetries = new Map();

const room = (params.get("room") || "").toLowerCase();
const savedRooms = readStored("swr.rooms", {});
const hostKey = hashParams.get("key") || savedRooms[room]?.hostKey;
if (!room || !hostKey) {
  alert("Falta la sala o la clave de anfitrión. Crea un estudio desde la portada.");
  location.href = "/";
  throw new Error("missing room or host key"); // stop here: the rest needs both
}
// Remember the key locally and scrub it from the address bar (screenshots, screen shares).
savedRooms[room] = { ...(savedRooms[room] || {}), room, hostKey, created: savedRooms[room]?.created || Date.now() };
const stored = writeStored("swr.rooms", savedRooms);
// Scrub the key only if the browser retained it; otherwise a reload locks
// the host out of their own studio.
if (stored) history.replaceState(null, "", `/studio?room=${encodeURIComponent(room)}`);

const LAYOUTS = [["solo", "Solo"], ["split", "Dividido"], ["grid", "Cuadrícula"], ["pip", "PiP"], ["sidebar", "Lateral"], ["spotlight", "Destacado"], ["screen", "Pantalla"], ["news", "Noticiero"]];

let state = {};
let keys = {};
let myId = "";
let peers = new Map();       // peerId -> info
const sources = new Map();   // streamId -> { video, stream, name, kind, level, owner, sub }
const local = new Map();     // streamId -> publication (host's own)
const sig = new Signal();
const relayUI = relayMonitor(sig, { banner: $("#relayBanner"), label: $("#relayLabel"), text: $("#relayText"), details: $("#relayUsage") }, message => toast(message, "err"));
for (const id of ["relayInfo", "relayDetails"]) $("#" + id).onclick = () => $("#relayDialog").showModal();
$("#closeRelayDialog").onclick = () => $("#relayDialog").close();
$("#bandwidthMode").onchange = () => setState({ bandwidth: $("#bandwidthMode").value });
let relayAccess = {}, changingRelay = false;
function renderRelayAccess() {
  const cloud = state.connection === "cloudflare";
  $("#relayChoiceStatus").textContent = cloud ? "Cloudflare seleccionado · con respaldo local y control de cuota" : "Relé local seleccionado";
  $("#relayChoiceHelp").textContent = !relayAccess.password ? "Cloudflare solo se puede activar en salas creadas con contraseña." : !relayAccess.available ? "El administrador debe configurar Cloudflare y la contraseña maestra en este servidor." : "Solo el anfitrión puede activar Cloudflare, validando la contraseña maestra en el servidor.";
  $("#cloudflareControls").classList.toggle("hidden", !relayAccess.password || !relayAccess.available);
  $("#useCloudflare").disabled = changingRelay || cloud;
  $("#useLocalRelay").disabled = changingRelay || !cloud;
}
async function changeRelay(provider) {
  const password = $("#cloudflareMaster").value;
  $("#cloudflareMaster").value = "";
  changingRelay = true; renderRelayAccess();
  try {
    await sig.request({ type: "relay", value: { provider, ...(provider === "cloudflare" ? { password } : {}) } });
    toast("Preferencia guardada. Reconectando la sala…");
  } catch (e) { toast(e.message, "err"); }
  finally { changingRelay = false; renderRelayAccess(); }
}
$("#useCloudflare").onclick = () => changeRelay("cloudflare");
$("#useLocalRelay").onclick = () => changeRelay("local");
$("#relayDialog").addEventListener("close", () => { $("#cloudflareMaster").value = ""; });
window.addEventListener("pagehide", e => { if (!e.persisted) relayUI.destroy(); });
const vdoUI = mountVdo({ root: $("#vdoDialog"), copy, notify: message => toast(message,"err"), onCapture: async () => {
  const media = await chooseScreen();
  const id = await addLocal(media, "camera", "VDO.Ninja", { stream:"host-vdo-" + crypto.randomUUID().slice(0,20), videoKbps: 1500, fps: 24 });
  if (id) {
    if (!media.getAudioTracks().length) toast("Se agregó el video. Para recibir audio, vuelve a capturar la pestaña y activa Compartir audio.","err");
    $("#vdoDialog").close(); toast("Fuente VDO.Ninja agregada al backstage. Puedes pasarla al escenario.");
  }
} });
$("#addVdo").onclick = () => $("#vdoDialog").showModal();
window.addEventListener("pagehide", e => { if (!e.persisted) vdoUI.destroy(); });
let program = null;          // publication of the composed program
let liveSince = 0;
const cinema = immersive($("#studioRoot"), $("#stageView"), $("#exitFullscreen"), { native: false });
$("#stageFullscreen").onclick = () => cinema.enter(true);
$("#cleanFullscreen").onclick = () => cinema.enter(true);
const telemetry = roomTelemetry(sig, () => sources.get(hostCamId)?.pub?.pc || program?.pc, $("#roomPing"), peers => {
  for (const tile of document.querySelectorAll("#backstage .tile")) {
    const label = tile.querySelector(".tile-latency");
    if (label) label.textContent = metricText(peers.get(tile.dataset.peer));
  }
});
$("#networkToggle").onclick = () => {
  const hidden = $("#studioRoot").classList.toggle("network-hidden");
  $("#networkToggle").setAttribute("aria-pressed", String(!hidden));
};

// ---------- program preview ----------
const comp = new Compositor($("#program"), sources, () => state);
comp.start();

// ---------- live scenes (VDO.Ninja "add to scene N") ----------
// Scene 1 is the program (what goes live / to OBS scene=1). Scenes 2..8 are
// extra outputs, each with its own lineup and layout: /view?scene=N.
const SCENES = ["1", "2", "3", "4", "5", "6", "7", "8"];
let editScene = "1";
const sceneOf = (name) => name === "1" ? { stage: state.stage || [], layout: state.layout || "grid", featured: state.featured || "" }
  : { stage: [], layout: "grid", featured: "", ...((state.outputs || {})[name] || {}) };
function setScene(name, patch) {
  if (name === "1") return setState(patch);
  setState({ outputs: { ...(state.outputs || {}), [name]: { ...sceneOf(name), ...patch } } });
}
const sceneState = (name) => ({ ...state, ...sceneOf(name) });
const scenePrev = new Compositor($("#scenePreview"), sources, () => sceneState(editScene));
function renderSceneBar() {
  const bar = $("#sceneBar");
  bar.replaceChildren(el("span", { class: "muted scenehint", text: "Editando:" }),
    ...SCENES.map((n) => {
      const count = sceneOf(n).stage.filter((id) => sources.has(id)).length;
      return el("button", { class: "scenecard" + (n === "1" ? " program" : "") + (editScene === n ? " active" : ""), title: n === "1" ? "Programa (lo que sale en vivo)" : `Escena ${n} (salida extra para OBS)`,
        onclick: () => { editScene = n; renderSceneBar(); renderState(); scheduleRoomOptions(); } },
        el("span", { class: "scenename", text: n === "1" ? "Programa" : `Escena ${n}` }),
        el("span", { class: "scenecount", text: count ? `${count} en escena` : "vacía" }));
    }),
    el("button", { class: "small scenelink", title: "Copiar el link de OBS de esta escena", onclick: () => keys.viewKey ? copy(sceneURL(editScene)) : toast("Aún conectando…", "err"), text: "🔗 Link OBS" }));
  const extra = editScene !== "1";
  $("#scenePreviewWrap").classList.toggle("hidden", !extra);
  $("#scenePreviewLabel").textContent = extra ? `Vista previa de la escena ${editScene} (no es lo que sale en vivo)` : "";
  if (extra) scenePrev.start(); else scenePrev.stop();
}
function sceneURL(n, extra = "") {
  return `${origin()}/view?room=${encodeURIComponent(room)}&scene=${n}${extra}&${obsSizing()}#key=${encodeURIComponent(keys.viewKey)}`;
}
const mixer = new AudioMixer();

// ---------- connection ----------
function setStatus(t, cls = "") { const s = $("#status"); s.textContent = t; s.className = "pill " + cls; }

let hostGeneration = 0, hostLossTimer;
sig.on("disconnected", () => {
  hostGeneration++;
  clearTimeout(hostLossTimer);
  setStatus("actualizando conexión…");
  hostLossTimer = setTimeout(() => { if (!sig.ready) setStatus("sin conexión", "red"); },10000);
});
sig.on("reconnected", async (m) => {
  const generation = hostGeneration, socket = sig.ws;
  clearTimeout(hostLossTimer);
  // The server dropped everything tied to the old connection: our
  // subscriptions (guests' video would freeze) and our own publications
  // (the host's camera would vanish from the show). Rebuild both.
  for (const [id, s] of [...sources]) {
    if (s.local) continue;
    s.stopWatch?.(); s.audioCleanup?.(); s.sub?.close(); s.level?.close?.(); roomAudio.remove(id);
    monitors.delete(id); sources.delete(id);
  }
  for (const timer of remoteRetries.values()) clearTimeout(timer); remoteRetries.clear(); remoteInfo.clear();
  try { program?.pc.close(); } catch {}
  program = null;
  // Install the snapshot before negotiation: newer state/stream-added messages
  // arriving while cameras restart must not be overwritten by an old welcome.
  onWelcome(m);
  for (const [id, pub] of [...local]) {
    const s = sources.get(id);
    if (!s) continue;
    try { pub.pc.close(); } catch {}
    try {
      const fresh = await publish(sig, s.stream, { ...pub.opts, stream: id }); // same id keeps its stage slot
      if (generation !== hostGeneration || socket !== sig.ws || sources.get(id) !== s || local.get(id) !== pub) { fresh.stop(); continue; }
      local.set(id, fresh); s.pub = fresh;
    } catch (e) {
      // Keep the actual capture and its stable identity if negotiation fails.
      if (generation === hostGeneration && socket === sig.ws) toast(`No se pudo restablecer ${s.name}: ${e.message}`, "err");
    }
  }
  if (generation !== hostGeneration || socket !== sig.ws) return;
  renderBackstage(); syncAudio(); setStatus("conectado", "green");
});

function onWelcome(m) {
  state = m.state; keys = m.keys || keys; myId = m.peerId || myId;
  relayAccess = m.relayAccess || {}; renderRelayAccess();
  $("#bandwidthMode").value = state.bandwidth || "balanced";
  renderInvite();
  if (m.persistence) renderPersistence(m.persistence, true);
  $("#chatlog").replaceChildren();
  peers = new Map((m.peers || []).map((p) => [p.id, p]));
  for (const s of m.streams || []) addRemote(s.id, s.kind, s.owner, "", s.revision);
  for (const c of m.chat || []) addChat(c);
  renderAll();
}

sig.connect({ type: "join", room, role: "host", key: hostKey, name: "Anfitrión" })
  .then((m) => { onWelcome(m); setStatus("conectado", "green"); })
  .catch((e) => { setStatus("error", "red"); toast("No se pudo entrar: " + e.message, "err"); });

sig.on("state", (m) => { state = m.state; $("#bandwidthMode").value = state.bandwidth || "balanced"; renderRelayAccess(); renderState(); });
sig.on("peer-joined", (m) => { peers.set(m.peer.id, m.peer); renderPeople(); toast(`${m.peer.name} entró`); });
sig.on("peer-updated", (m) => {
  const wasPending = peers.get(m.peer.id)?.screenRequested;
  peers.set(m.peer.id, m.peer); renderPeople(); renderBackstage();
  if (m.peer.screenRequested && !wasPending) toast(`${m.peer.name} solicita compartir pantalla`);
});
sig.on("peer-left", (m) => { const p = peers.get(m.peerId); peers.delete(m.peerId); renderPeople(); if (p) toast(`${p.name} salió`); });
sig.on("stream-added", (m) => addRemote(m.info.id, m.info.kind, m.info.owner, m.name, m.info.revision));
sig.on("stream-updated", (m) => { if (staleRevision(m.info.revision, remoteInfo.get(m.info.id)?.revision)) return; removeSource(m.info.id); addRemote(m.info.id, m.info.kind, m.info.owner, m.name, m.info.revision); });
sig.on("stream-removed", (m) => removeSource(m.stream, m.revision));
sig.on("chat", (m) => addChat(m.comment));
sig.on("knock", (m) => addKnock(m));
sig.on("knock-cancel", (m) => { if (knocks.delete(m.peerId)) { renderKnocks(); if (m.action !== "admitted") toast("Un invitado dejó la sala de espera"); } });
sig.on("reaction", (m) => flyReaction(m.text));
sig.on("restream", (m) => { const r = m.state.restream; $("#restreamStats").textContent = r ? (r.stats || "") + (r.lastError ? " · " + r.lastError : "") : ""; });
sig.on("error", (m) => toast(m.error, "err"));

async function addRemote(id, kind, owner, name, revision) {
  if (local.has(id) || kind === "program") return;
  if (staleRevision(revision, remoteInfo.get(id)?.revision)) return;
  if (sources.has(id) && (!revision || sources.get(id).revision === revision)) return;
  if (sources.has(id)) removeSource(id);
  remoteInfo.set(id, { kind, owner, name, revision });
  clearTimeout(remoteRetries.get(id)); remoteRetries.delete(id);
  const placeholder = { kind, owner, revision, name: name || id, video: document.createElement("video"), stream: null, level: () => 0 };
  sources.set(id, placeholder);
  try {
    const sub = await subscribe(sig, id);
    if (sources.get(id) !== placeholder) { sub.close(); return; } // removed while connecting
    const v = placeholder.video;
    v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = sub.stream;
    v.play().catch(() => {});
    Object.assign(placeholder, { stream: sub.stream, sub, name: sub.name || placeholder.name });
    const refreshAudio = () => { placeholder.level?.close?.(); placeholder.level = levelMeter(sub.stream); syncAudio(); };
    sub.stream.addEventListener("addtrack", refreshAudio);
    placeholder.audioCleanup = () => sub.stream.removeEventListener("addtrack", refreshAudio);
    monitor(id, sub.stream); refreshAudio();
    renderBackstage();
  } catch (e) {
    if (sources.get(id) === placeholder) retryRemote(id, placeholder);
    console.warn("subscribe", id, e);
  }
}

function retryRemote(id, entry) {
  if (sources.get(id) !== entry || sig.closed || !remoteInfo.has(id)) return;
  const info = remoteInfo.get(id); removeSource(id);
  remoteInfo.set(id, info);
  remoteRetries.set(id, setTimeout(() => { remoteRetries.delete(id); if (remoteInfo.has(id) && sig.ready) addRemote(id, info.kind, info.owner, info.name, info.revision); }, 1000));
}
function removeSource(id, revision) {
  // The SFU removed an old transport, not the host's physical camera/mic.
  // Its capture must remain available for the new authenticated socket.
  if (local.has(id)) return;
  const s = sources.get(id);
  if (revision && s?.revision && revision !== s.revision) return;
  clearTimeout(remoteRetries.get(id)); remoteRetries.delete(id); remoteInfo.delete(id);
  if (!s) return;
  s.stopWatch?.(); s.audioCleanup?.(); s.sub?.close(); s.level?.close?.();
  roomAudio.remove(id); monitors.delete(id);
  sources.delete(id);
  renderBackstage();
  syncAudio();
}

// ---------- host monitoring (hear guests in your headphones) ----------
function monitor(id, stream) {
  if (monitors.has(id)) return;
  const a = roomAudio.add(id, stream);
  applySink(a, prefs.speaker);
  monitors.set(id, a);
  syncMonitor();
}
function syncMonitor() {
  for (const [id, a] of monitors) { a.muted = !monitorOn; a.volume = Math.min(1, localVol(id)); }
  $("#monitor").classList.toggle("on", monitorOn);
}
const localVolumes = readStored("swr.mon", {}, true);
const localVol = (id) => localVolumes[id] ?? 1;
$("#monitor").onclick = () => { monitorOn = !monitorOn; try { localStorage.setItem("swr.monitor", monitorOn ? "1" : "0"); } catch {} syncMonitor(); scheduleRoomOptions(); toast(monitorOn ? "Escuchando a los invitados" : "Monitor silenciado"); };

// ---------- host's own sources ----------
async function addLocal(media, kind, name, extra = {}, cleanup = null) {
  try {
    const pub = await publish(sig, media, { kind, name, videoKbps: kind === "screen" ? 6000 : 4000, contentHint: kind === "screen" ? "detail" : "motion", ...extra });
    const v = el("video", { muted: true, playsinline: true, autoplay: true });
    v.muted = true; v.srcObject = media; v.play().catch(() => {});
    sources.set(pub.id, { video: v, stream: media, name, kind, owner: "me", level: levelMeter(media), local: true, pub, cleanup });
    local.set(pub.id, pub);
    // Camera suspension or a device swap must not unpublish its live microphone.
    if (kind !== "camera") media.getVideoTracks()[0]?.addEventListener("ended", () => stopLocal(pub.id));
    renderBackstage();
    return pub.id;
  } catch (e) { toast(explain(e), "err"); stopScreenCapture(media); cleanup?.(); }
}

function stopLocal(id) {
  const pub = local.get(id), s = sources.get(id);
  if (!pub) return;
  pub.stop();
  stopScreenCapture(s?.stream);
  s?.cleanup?.();
  local.delete(id); sources.delete(id);
  if (id === hostCamId) { hostCamId = ""; $("#addCam").textContent = "Cámara"; }
  setState({ stage: (state.stage || []).filter((x) => x !== id) });
  renderBackstage();
}

$("#addCam").onclick = async () => {
  if (hostCamId) { // second press: another camera from this computer
    return pickExtraCamera();
  }
  const btn = $("#addCam"); btn.disabled = true; btn.textContent = "Abriendo…";
  const { stream, warnings } = await openMedia(prefs).finally(() => { btn.disabled = false; btn.textContent = "Cámara"; });
  warnings.forEach((w) => toast(w, "err"));
  if (!stream.getTracks().length) return toast(warnings.length ? "No se pudo abrir ninguna cámara ni micrófono." : "No hay cámara ni micrófono conectados.", "err");
  const id = await addLocalCam(stream, "Anfitrión");
  if (id) { hostCamId = id; setState({ stage: [...new Set([...(state.stage || []), id])] }); $("#addCam").textContent = "Otra cámara"; }
};
async function addLocalCam(stream, name) {
  let slot=2; while (local.has("host-camera-"+slot)) slot++;
  const cameraSlot = !hostCamId ? "host-camera" : "host-camera-" + slot;
  const id = await addLocal(stream, "camera", name, { stream: cameraSlot, videoKbps: kbpsFor(Number(prefs.quality)), fps: Number(prefs.fps) || 30, codec: prefs.codec, stereo: prefs.stereo, audioKbps: prefs.stereo ? 256 : 128 });
  if (id) sources.get(id).mirror = false;
  return id;
}
async function pickExtraCamera() {
  const { cams } = await listDevices();
  const used = new Set([...sources.values()].filter((s) => s.local).map((s) => s.stream.getVideoTracks()[0]?.getSettings().deviceId));
  const options = cams.filter((c) => !used.has(c.deviceId));
  if (!options.length) return toast("No hay otra cámara libre en este equipo.", "err");
  const dlg = el("dialog", { class: "card devdialog" }, el("h3", { text: "Agregar otra cámara" }),
    ...options.map((c, i) => el("button", { onclick: async () => {
      dlg.close(); dlg.remove();
      const { stream, warnings } = await openMedia({ ...prefs, camera: c.deviceId, mic: "none" });
      warnings.forEach((w) => toast(w, "err"));
      if (stream.getVideoTracks().length) await addLocalCam(stream, (c.label || `Cámara ${i + 2}`).slice(0, 30));
    }, text: c.label || `Cámara ${i + 2}` })),
    el("button", { class: "small", onclick: () => { dlg.close(); dlg.remove(); }, text: "Cancelar" }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- device settings (host) ----------
async function onPrefChange(p, what, quiet = false) {
  scheduleRoomOptions();
  if (what === "speaker") { for (const a of monitors.values()) applySink(a, p.speaker); return; }
  const s = hostCamId && sources.get(hostCamId);
  if (!s || what === "other") return;
  const kind = what === "video" ? "video" : "audio";
  const { stream, warnings } = await openMedia({ ...prefs, camera: kind === "video" ? prefs.camera : "none", mic: kind === "audio" ? prefs.mic : "none" });
  if (sources.get(hostCamId) !== s || sig.closed) { stream.getTracks().forEach(t => t.stop()); return; }
  warnings.forEach((w) => toast(w, "err"));
  const fresh = kind === "video" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
  const old = kind === "video" ? s.stream.getVideoTracks()[0] : s.stream.getAudioTracks()[0];
  if (fresh && old) fresh.enabled = old.enabled;
  if (old) { s.stream.removeTrack(old); old.stop(); }
  if (fresh) s.stream.addTrack(fresh);
  await s.pub.replaceTrack(kind, fresh || null);
  if (kind === "video") await s.pub.setBitrate(kbpsFor(Number(prefs.quality)), Number(prefs.fps) || 30);
  else s.level = levelMeter(s.stream);
  s.video.srcObject = s.stream; s.preview && (s.preview.srcObject = s.stream);
  $("#devCamCtl").replaceChildren(cameraControls(s.stream.getVideoTracks()[0]) || "");
  syncAudio();
  if (!quiet) toast(kind === "video" ? "Cámara cambiada" : "Micrófono cambiado", "ok");
}
$("#settings").onclick = async () => {
  const dlg = settingsDialog();
  await renderPanel($("#devPanel"), prefs, onPrefChange);
  const s = hostCamId && sources.get(hostCamId);
  $("#devCamCtl").replaceChildren((s && cameraControls(s.stream.getVideoTracks()[0])) || el("p", { class: "muted", style: "font-size:12px", text: "Los cambios se aplican a tu cámara principal al instante." }));
  dlg.showModal();
};
onDeviceChange(() => { if ($("#devDialog")?.open) renderPanel($("#devPanel"), prefs, onPrefChange); });
$("#addScreen").onclick = async () => {
  try {
    const m = await chooseScreen();
    if(local.has("host-screen"))stopLocal("host-screen");
    const id = await addLocal(m, "screen", "Pantalla", { stream:"host-screen", stereo: true, audioKbps: 192, codec: prefs.codec });
    if (id) toast(screenAudioNotice(m), m.getAudioTracks().length ? "ok" : "");
    if (id) setState({ stage: [...(state.stage || []), id], layout: "screen" });
  } catch (e) { if (e.name !== "NotAllowedError") toast("Pantalla: " + e.message, "err"); }
};
$("#addMedia").onclick = () => $("#mediaFile").click();
$("#mediaFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = "";
  const url = URL.createObjectURL(f);
  let media, cleanup;
  try {
    if (f.type.startsWith("image/")) {
      const img = new Image(); img.src = url; await img.decode();
      const c = el("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      const timer = setInterval(() => ctx.drawImage(img, 0, 0), 500);
      ctx.drawImage(img, 0, 0);
      media = c.captureStream(2);
      cleanup = () => { clearInterval(timer); URL.revokeObjectURL(url); }; // was never cleared
    } else {
      const v = el("video", { loop: true, playsinline: true }); v.src = url;
      await v.play();
      media = v.captureStream ? v.captureStream() : v.mozCaptureStream();
      cleanup = () => { v.pause(); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); };
    }
  } catch (x) { URL.revokeObjectURL(url); return toast("No se pudo abrir el archivo: " + x.message, "err"); }
  await addLocal(media, "media", f.name.replace(/\.[^.]+$/, "").slice(0, 40), {}, cleanup);
};

// ---------- state helpers ----------
function setState(patch) { sig.send({ type: "state", value: patch }); }
const onStage = (id, n = editScene) => sceneOf(n).stage.includes(id);
function toggleStage(id) {
  const stage = sceneOf(editScene).stage;
  setScene(editScene, { stage: onStage(id) ? stage.filter((x) => x !== id) : [...stage, id] });
}
const scenesWith = (id) => SCENES.filter((n) => onStage(id, n));

function syncAudio() { mixer.sync((state.stage || []).filter((id) => sources.has(id)), sources, state); }

// ---------- rendering ----------
function renderAll() { renderState(); renderBackstage(); renderPeople(); renderObs(); }

function renderState() {
  $("#title").textContent = state.title || room;
  document.title = (state.title || room) + " · StreamWebRom";
  $("#showTitle").value = state.title || "";
  $("#lobbyToggle").checked = !!state.lobby;
  $$("#layouts button").forEach((b) => b.classList.toggle("active", b.dataset.l === sceneOf(editScene).layout));
  renderSceneBar();
  const live = !!state.live;
  $("#golive").textContent = live ? "Terminar" : "Transmitir";
  $("#golive").classList.toggle("live", live);
  $("#golive").classList.toggle("primary", !live);
  $("#liveBadge").classList.toggle("hidden", !live);
  if (live && !liveSince) liveSince = (state.restream?.since || Date.now() / 1000) * 1000;
  if (!live) liveSince = 0;
  const rec = (state.recording || []).length > 0;
  $("#recordLabel").textContent = rec ? "Detener grabación" : "Grabar";
  $("#record").setAttribute("aria-label",rec ? "Detener grabación" : "Grabar");
  $("#record").classList.toggle("recording", rec);
  const b = state.brand || {};
  $("#brandColor").value = b.color || "#7c5cff";
  $("#brandTheme").value = b.theme || "bubble";
  if (document.activeElement !== $("#brandBg")) $("#brandBg").value = b.background || "";
  $("#brandNames").checked = b.showNames !== false;
  $("#muteStage").classList.toggle("off", !!state.stageMuted);
  $("#muteStage").textContent = state.stageMuted ? "Activar escenario" : "Silenciar escenario";
  renderBackstage(); renderBanners(); renderScenes(); syncAudio();
}

const obsSizing = () => new URLSearchParams({ quality: $("#obsQuality").value, fps: $("#obsFPS").value });
function obsURL(id) {
  if (!keys.viewKey) return "";
  const q = new URLSearchParams({ room, stream: id, quality: $("#obsQuality").value, fps: $("#obsFPS").value });
  if (!$("#obsCover")?.checked) q.set("cover", "0");
  if ($("#obsMute")?.checked) q.set("mute", "1");
  if ($("#obsLabel")?.checked) q.set("label", "1");
  if ($("#obsTransparent")?.checked) q.set("transparent", "1");
  return `${origin()}/view?${q}#key=${encodeURIComponent(keys.viewKey)}`;
}
const toggleMap = (key, id) => setState({ [key]: { ...(state[key] || {}), [id]: !(state[key] || {})[id] } });

function sourceQuality(id, source) {
  const select = el("select", { "aria-label": `Calidad de envío de ${source.name}`, title: "Calidad codificada de esta cámara para todos sus receptores" },
    ...QUALITIES.map(([value, text]) => el("option", { value, text })));
  const measured = source.stream?.getVideoTracks()[0]?.getSettings?.().height;
  select.value = String(source.sendHeight || (QUALITIES.some(([v]) => Number(v) === measured) ? measured : 720));
  select.onchange = async () => {
    const height = Number(select.value), fps = 30, kbps = kbpsFor(height);
    select.disabled = true;
    try {
      if (source.local) {
        const track = source.stream.getVideoTracks()[0], raw = track?.raw || track;
        if (!raw?.applyConstraints) throw new Error("Esta fuente no permite cambiar su resolución");
        await raw.applyConstraints({ width: { ideal: Math.round(height * 16 / 9) }, height: { ideal: height }, frameRate: { ideal: fps } });
        await source.pub.setBitrate(kbps, fps); source.sendHeight = height;
        toast(`Envío ajustado a ${height}p · ${kbps} kbps; la resolución real depende de la cámara`, "ok");
      } else {
        source.sendHeight = height;
        req(source.owner, "quality", { stream: id, height, fps, kbps });
        toast(`Solicitando envío ${height}p a ${source.name}`);
      }
    } catch (e) { toast(e.message, "err"); }
    finally { select.disabled = false; }
  };
  return el("label", { class: "source-quality" }, "Calidad de envío ", select);
}
let sourceSettingsId = "";
function openSourceSettings(id) {
  if (!sources.has(id)) return;
  sourceSettingsId = id; renderSourceSettings(); $("#sourceSettings").showModal();
}
$("#closeSourceSettings").onclick = () => $("#sourceSettings").close();
$("#sourceSettings").addEventListener("close", () => {
  const id = sourceSettingsId; sourceSettingsId = "";
  $("#sourceSettingsVideo").pause(); $("#sourceSettingsVideo").srcObject = null;
  document.querySelector(`#backstage [data-id="${CSS.escape(id)}"] .source-options`)?.focus();
});
function renderSourceSettings() {
  if (!sourceSettingsId) return;
  const id = sourceSettingsId, s = sources.get(id), dlg = $("#sourceSettings");
  if (!s) { dlg.close(); return; }
  const owner = peers.get(s.owner), muted = !!state.muted?.[id], hidden = !!state.hidden?.[id];
  $("#sourceSettingsTitle").textContent = state.labels?.[id] || s.name;
  const video = $("#sourceSettingsVideo");
  if (video.srcObject !== s.stream) { video.srcObject = s.stream; video.play().catch(() => {}); }
  video.style.opacity = hidden || s.camOff ? "0" : "1";
  const button = (text, action, attrs = {}) => el("button", { text, onclick: action, ...attrs });
  const actions = [
    button(onStage(id) ? "Quitar del escenario" : "Pasar al escenario", () => toggleStage(id)),
    button(sceneOf(editScene).featured === id ? "Quitar destacado" : "Destacar en esta escena", () => setScene(editScene, { featured: sceneOf(editScene).featured === id ? "" : id })),
    button(muted ? "Activar audio del programa" : "Silenciar en el programa", () => toggleMap("muted", id)),
    button(hidden ? "Mostrar video" : "Ocultar video", () => toggleMap("hidden", id), { title: hidden ? "Mostrar video" : "Ocultar video en escenario y backstage (mantiene el audio)" }),
    button("Copiar enlace OBS", () => keys.viewKey ? copy(obsURL(id)) : toast("Aún conectando…", "err")),
    button("Renombrar", () => rename(id, s)),
  ];
  if (!s.local) actions.push(
    button(owner?.mic === false ? "Pedir micrófono" : "Silenciar micrófono", () => sig.send({ type:"request", target:s.owner, action:owner?.mic === false ? "unmute" : "mute" })),
    button(owner?.cam === false ? "Pedir cámara" : "Apagar cámara", () => sig.send({ type:"request", target:s.owner, action:owner?.cam === false ? "camon" : s.kind === "screen" ? "screenoff" : "camoff" })),
    button("Control remoto", () => { dlg.close(); if (owner) openRemote(owner.id); }),
    button("Expulsar participante", () => { if (owner && confirm(`¿Expulsar a ${owner.name}?`)) sig.send({ type:"kick", target:owner.id }); })
  );
  else actions.push(button("Detener esta fuente", () => stopLocal(id)));
  $("#sourceSettingsActions").replaceChildren(...actions);
  const vol = el("input", { type:"range", min:0, max:2, step:.05, value:state.volumes?.[id] ?? 1, "aria-label":"Volumen en el programa" });
  vol.onchange = () => setState({ volumes:{ ...(state.volumes || {}), [id]:Number(vol.value) } });
  $("#sourceSettingsQuality").replaceChildren(...(s.kind === "camera" ? [sourceQuality(id,s)] : []), el("label",{},"Volumen del programa",vol));
}
function renderBackstage() {
  $("#sourceCount").textContent=`${sources.size} ${sources.size===1 ? "fuente" : "fuentes"}`;
  const box = $("#backstage");
  box.replaceChildren();
  if (!sources.size) box.append(el("div", { class: "empty" }, el("b", { text: "Aún no hay fuentes" }), el("span", { class: "muted", text: "Invita gente o agrega tu cámara o pantalla desde la barra de abajo." })));
  for (const [id, s] of sources) {
    const owner = peers.get(s.owner);
    s.camOff = !!(owner && owner.cam === false && s.kind === "camera");
    if (!s.preview) { // reuse the element: no flicker, no extra decoders
      s.preview = el("video", { muted: true, playsinline: true, autoplay: true });
      s.preview.muted = true;
    }
    if (s.preview.srcObject !== s.stream) { s.preview.srcObject = s.stream; s.preview.play().catch(() => {}); }
    const progMuted = !!state.muted?.[id], hidden = !!state.hidden?.[id];
    s.preview.onclick = () => openSourceSettings(id);
    s.preview.tabIndex = 0; s.preview.setAttribute("aria-label", "Ampliar " + s.name);
    s.preview.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSourceSettings(id); } };
    const tile = el("div", { class: "tile" + (onStage(id) ? " stage" : "") + (progMuted ? " progmuted" : "") + (hidden ? " video-hidden" : ""), "data-id": id, "data-kind": s.kind, "data-peer": s.local ? myId : s.owner },
      s.preview,
      el("span", { class: "tile-latency", title: "RTT del participante al servidor (ida y vuelta)", text: "RTT —" }),
      owner?.hand ? el("span", { class: "hand", text: "✋" }) : null,
      scenesWith(id).length ? el("span", { class: "scenes", title: "Escenas donde aparece", text: scenesWith(id).map((n) => n === "1" ? "P" : n).join(" ") }) : null,
      el("span", { class: "name", text: ((state.labels && state.labels[id]) || s.name + (s.kind === "screen" ? " · pantalla" : "")) + (owner && owner.mic === false ? " 🔇" : "") }),
      el("div", { class: "source-quick-actions" },
        el("button", { class: "stagebtn " + (onStage(id) ? "on" : ""), onclick: () => toggleStage(id), text: onStage(id) ? "Quitar" : (editScene === "1" ? "Al escenario" : `A escena ${editScene}`) }),
        el("button", { class:"source-options", "aria-haspopup":"dialog", onclick:() => openSourceSettings(id), text:"Opciones" })));
    box.append(tile);
  }
  telemetry.refresh();
  renderSourceSettings();
}

function rename(id, s) {
  const n = prompt("Nombre / título en pantalla", (state.labels && state.labels[id]) || s.name);
  if (n == null) return;
  setState({ labels: { ...(state.labels || {}), [id]: n.trim() } });
}

const screenDecision = (target, action) => sig.send({ type: "screen-permission", target, action });
function renderScreenRequests() {
  const box = $("#screenRequests"), pending = [...peers.values()].filter(p => p.screenRequested);
  box.classList.toggle("hidden", !pending.length);
  box.replaceChildren(el("b", { text: "Solicitudes para compartir pantalla" }), ...pending.map(p =>
    el("div", { class: "item", "data-peer": p.id }, el("span", { class: "grow", text: p.name + " quiere compartir pantalla" }),
      el("button", { class: "small primary", onclick: () => screenDecision(p.id, "allow"), text: "Autorizar pantalla" }),
      el("button", { class: "small", onclick: () => screenDecision(p.id, "deny"), text: "Rechazar pantalla" }))));
}
function renderPeople() {
  renderScreenRequests();
  const box = $("#people");
  box.replaceChildren();
  for (const p of peers.values()) {
    if (p.role === "host") continue;
    box.append(el("div", { class: "item" },
      el("span", { class: "grow", text: `${p.hand ? "✋ " : ""}${p.name}` }),
      el("span", { class: "pill", text: (p.mic ? "🎙️" : "🔇") + (p.cam ? " 📷" : "") }),
      el("button", { class: "small", onclick: () => sig.send({ type: "request", target: p.id, action: p.mic ? "mute" : "unmute" }), text: p.mic ? "Silenciar" : "Pedir audio" }),
      el("button", { class: "small", onclick: () => sig.send({ type: "request", target: p.id, action: p.cam ? "camoff" : "camon" }), text: p.cam ? "Apagar cámara" : "Pedir cámara" }),
      p.screenAllowed ? el("button", { class: "small", onclick: () => screenDecision(p.id, "revoke"), text: "Revocar pantalla" }) : null,
      p.hand ? el("button", { class: "small", onclick: () => sig.send({ type: "request", target: p.id, action: "lowerhand" }), text: "Bajar mano" }) : null,
      el("button", { class: "small", onclick: () => openRemote(p.id), text: "🎛️ Control" }),
      el("button", { class: "small danger", onclick: () => confirm(`¿Expulsar a ${p.name}?`) && sig.send({ type: "kick", target: p.id }), text: "Expulsar" })));
  }
  if (!box.children.length) box.append(el("p", { class: "muted", text: "Nadie más todavía." }));
}

// Guests in the waiting room: shown over the backstage and in the People tab,
// with a button to pass each one (or everyone) to the backstage.
const knocks = new Map(); // peerId -> name
function addKnock(m) {
  if (knocks.has(m.peerId)) return; // re-sent on reconnect
  knocks.set(m.peerId, m.name);
  toast(`${m.name} está en la sala de espera`);
  renderKnocks();
}
function letIn(id) {
  const name = knocks.get(id);
  knocks.delete(id); renderKnocks();
  sig.send({ type: "admit", target: id });
  toast(`${name} pasó al backstage`);
}
function letOut(id) { knocks.delete(id); renderKnocks(); sig.send({ type: "deny", target: id }); }
function letAllIn() { knocks.clear(); renderKnocks(); sig.send({ type: "admit-all" }); toast("Todos pasaron al backstage"); }
function renderKnocks() {
  const row = (id, name) => el("div", { class: "item knock", "data-peer": id },
    el("span", { class: "grow", text: "🚪 " + name }),
    el("button", { class: "small primary", onclick: () => letIn(id), text: "Pasar al backstage" }),
    el("button", { class: "small", onclick: () => letOut(id), text: "Rechazar" }));
  const list = [...knocks];
  $("#knocks").replaceChildren(...list.map(([id, n]) => row(id, n)));
  const wr = $("#waitroom");
  wr.classList.toggle("hidden", !list.length);
  wr.replaceChildren(
    el("div", { class: "waithead" }, el("b", { text: `Sala de espera · ${list.length}` }), el("span", { class: "grow" }),
      list.length > 1 ? el("button", { class: "small primary", onclick: letAllIn, text: "Pasar a todos" }) : null),
    ...list.map(([id, n]) => row(id, n)));
}

// ---------- layouts ----------
LAYOUTS.forEach(([l, label], i) => $("#layouts").append(el("button", { "data-l": l, title: `${label} (${i + 1})`, "aria-label": label, onclick: () => setScene(editScene, { layout: l }) },
  el("i", { class: "lp", "aria-hidden": "true" }), el("span", { text: label }))));
$("#muteStage").onclick = () => setState({ stageMuted: !state.stageMuted });
$("#muteAll").onclick = () => { sig.send({ type: "request", target: "*", action: "mute" }); toast("Silenciando a todos los invitados"); };
$("#askUnmuteAll").onclick = () => { sig.send({ type: "request", target: "*", action: "unmute" }); toast("Pedí a todos activar el micrófono"); };
$("#camsOff").onclick = () => confirm("¿Apagar la cámara de todos los invitados?") && allGuests("camoff");
$("#askCamsOn").onclick = () => allGuests("camon");

// Quick "everyone" controls, also reachable from every camera's 👥 menu.
const ALL_ACTIONS = {
  mute: ["🔇 Silenciar a todos", "Silenciando a todos los invitados"],
  unmute: ["🎙️ Pedir audio a todos", "Pedí a todos activar el micrófono"],
  camoff: ["📷✕ Apagar cámaras de todos", "Apagando las cámaras de todos los invitados"],
  camon: ["📷 Pedir cámaras a todos", "Pedí a todos encender la cámara"],
};
function allGuests(action) {
  if (![...peers.values()].some((p) => p.role !== "host")) return toast("No hay invitados conectados", "err");
  sig.send({ type: "request", target: "*", action });
  toast(ALL_ACTIONS[action][1]);
}
let allMenuEl;
function allMenu(anchor) {
  allMenuEl?.remove();
  const guests = [...peers.values()].filter((p) => p.role !== "host");
  const micsOn = guests.filter((p) => p.mic !== false).length, camsOn = guests.filter((p) => p.cam !== false).length;
  allMenuEl = el("div", { class: "allmenu card", role: "menu" },
    el("div", { class: "muted", text: `Todos los invitados (${guests.length}) · 🎙️ ${micsOn} · 📷 ${camsOn}` }),
    ...Object.entries(ALL_ACTIONS).map(([a, [label]]) => el("button", { class: "small", role: "menuitem", onclick: () => { allMenuEl.remove(); allGuests(a); }, text: label })),
    el("p", { class: "muted", style: "margin:0;font-size:11px", text: "Encender pide permiso al invitado: el navegador no deja activar su cámara o micrófono sin que acepte." }));
  document.body.append(allMenuEl);
  const r = anchor.getBoundingClientRect();
  allMenuEl.style.left = Math.max(8, Math.min(window.innerWidth - allMenuEl.offsetWidth - 8, r.left)) + "px";
  allMenuEl.style.top = (r.bottom + allMenuEl.offsetHeight + 8 > window.innerHeight ? r.top - allMenuEl.offsetHeight - 6 : r.bottom + 6) + "px";
  setTimeout(() => document.addEventListener("pointerdown", function off(e) { if (!allMenuEl?.contains(e.target)) { allMenuEl?.remove(); document.removeEventListener("pointerdown", off); } }), 0);
}
$("#lowerHands").onclick = () => sig.send({ type: "request", target: "*", action: "lowerhand" });
$("#clearStage").onclick = () => setScene(editScene, { stage: [] });
$("#allStage").onclick = () => setScene(editScene, { stage: [...sources.keys()].slice(0, 25) });

// Pantalla virtual: the clean program in its own window. Put it full screen on a
// second monitor/projector, capture it with OBS "Window capture", or start OBS
// Virtual Camera from it to use the show as a webcam in Zoom/Meet/Teams.
$("#virtual").onclick = () => {
  if (!keys.viewKey) return toast("Aún conectando…", "err");
  const url = `${origin()}/view?room=${encodeURIComponent(room)}&scene=1&status=0&virtual=1#key=${encodeURIComponent(keys.viewKey)}`;
  const w = window.open(url, "swr-virtual-" + room, "popup,width=1280,height=720");
  if (!w) copy(url);
};

$("#countdown").onclick = () => setState({ countdown: state.countdown > Date.now() ? 0 : Date.now() + 5 * 60 * 1000 });
$("#clearScreen").onclick = () => setState({ banner: null, comment: null });
document.addEventListener("keydown", (e) => {
  const a = document.activeElement;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(a?.tagName) || a?.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector("dialog[open]")) return; // Ctrl+1 is the browser's
  const key = e.key.toLowerCase(); // Caps Lock / Shift should not break shortcuts
  const n = parseInt(key, 10);
  if (n >= 1 && n <= LAYOUTS.length) setScene(editScene, { layout: LAYOUTS[n - 1][0] });
  if (key === "c") setState({ banner: null, comment: null });
  if (key === "s") setState({ stageMuted: !state.stageMuted });
  if (key === "b" && state.banners?.length) setState({ banner: state.banner ? null : state.banners[0] });
});

// ---------- chat ----------
let unread = 0;
function addChat(c) {
  const show = el("button", { class: "small act", title: "Mostrar en pantalla", onclick: () => setState({ comment: state.comment?.id === c.id ? null : c }), text: "📺" });
  appendChat($("#chatlog"), chatMessage(c, { myId, actions: [show] }));
  const chatTab = $('#tabs [data-tab="chat"]');
  if (chatTab && !chatTab.classList.contains("active") && c.peerId !== myId) { unread++; chatTab.dataset.unread = unread > 99 ? "99+" : String(unread); }
}
const chatSend = (x) => sig.send(x.sticker ? { type: "chat", kind: "sticker", text: x.sticker } : { type: "chat", text: x.text });
const composer = mountComposer($("#chatInput").parentElement, $("#chatInput"), chatSend);
$("#chatSend").onclick = composer.send;
$("#chatInput").addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && composer.send());

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
let dests = readStored(destKey, readStored("swr.dest", []));
const saveDests = () => { if (!writeStored(destKey, dests)) toast("No se pudieron guardar los destinos en este navegador", "err"); writeStored("swr.dest", dests); renderDests(); scheduleRoomOptions(); };
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
// Show the server, never the stream key (RTMP path or SRT ?streamid=/passphrase).
const maskURL = (u) => { const m = /^(\w+:\/\/[^/?#]+)(.*)$/.exec(u); return m ? m[1] + (m[2] ? "/••••" : "") : "••••"; };
function renderDests() {
  const box = $("#destList");
  box.replaceChildren();
  dests.forEach((d, i) => box.append(el("div", { class: "item" },
    el("input", { type: "checkbox", checked: d.enabled, onchange: (e) => { d.enabled = e.target.checked; saveDests(); } }),
    el("span", { class: "grow", text: `${d.name} · ${maskURL(d.url)}` }),
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
$("#invite").onclick = () => copy(inviteURL());

function linkRow(label, value) {
  const i = el("input", { readonly: true, value });
  return el("div", {}, el("label", { text: label }), el("div", { class: "copy" }, i, el("button", { class: "small", onclick: () => copy(value), text: "Copiar" })));
}
function renderObs() {
  if (!keys.viewKey) return;
  const vk = encodeURIComponent(keys.viewKey), r = encodeURIComponent(room);
  const box = $("#obsLinks");
  box.replaceChildren(
    linkRow("Programa completo (escena, con banners y marca)", `${origin()}/view?room=${r}&scene=1&${obsSizing()}#key=${vk}`),
    linkRow("Programa con fondo transparente (para tus propias escenas)", `${origin()}/view?room=${r}&scene=1&transparent=1&${obsSizing()}#key=${vk}`),
    linkRow("Invitación para invitados (entran directo al backstage)", inviteURL()),
    linkRow("WHEP del programa (reproductores WHEP / OBS 31+)", `${origin()}/whep/${r}/program`),
    linkRow("Clave WHEP (Bearer)", keys.viewKey),
  );
  box.append(linkRow("Pantalla virtual (programa limpio, sin textos de estado)", `${origin()}/view?room=${r}&scene=1&status=0&${obsSizing()}#key=${vk}`));
  for (const n of SCENES.slice(1)) if (sceneOf(n).stage.length) box.append(linkRow(`Escena ${n} (${sceneOf(n).stage.length} en escena)`, sceneURL(n)));
  box.append(linkRow("Co-director (control total del estudio: compártelo solo con quien produce contigo)", `${origin()}/studio?room=${r}#key=${encodeURIComponent(hostKey)}`));
  for (const [id, s] of sources) box.append(linkRow(`Cámara: ${(state.labels && state.labels[id]) || s.name}${s.kind === "screen" ? " · pantalla" : ""}`, obsURL(id)));
  $("#whipLinks").replaceChildren(
    linkRow("Servidor WHIP", `${origin()}/whip/${r}/obs`),
    linkRow("Bearer Token", keys.pushKey));
}
// Refresh while visible, but not while the user is selecting or copying a link.
setInterval(() => { const p = $('[data-pane="obs"]'); if (p.classList.contains("active") && !p.contains(document.activeElement)) renderObs(); }, 3000);

// ---------- tabs & misc ----------
function activateTab(name) {
  studioWorkspace.openPanel();
  $("#activePanelTitle").textContent = $(`#tabs [data-tab="${name}"]`)?.textContent || "Producción";
  $$("#tabs button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "chat") { unread = 0; delete $('#tabs [data-tab="chat"]').dataset.unread; const l = $("#chatlog"); l.scrollTop = l.scrollHeight; }
  $$(".tabpane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  if (name === "obs") renderObs();
}
$$("#tabs button[data-tab]").forEach((b) => (b.onclick = () => activateTab(b.dataset.tab)));
["#obsCover", "#obsMute", "#obsLabel", "#obsTransparent", "#obsQuality", "#obsFPS"].forEach((sel) => $(sel).addEventListener("change", renderObs));

function flyReaction(e) {
  const n = el("div", { class: "reaction-fly", text: e });
  n.style.left = 20 + Math.random() * 60 + "vw";
  document.body.append(n);
  setTimeout(() => n.remove(), 2500);
}

window.addEventListener("beforeunload", (e) => { if (state.live) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("click", () => mixer.ctx.resume(), { once: true });
api(`/api/rooms/${encodeURIComponent(room)}`).catch(() => {});

// ---------- director remote control (VDO.Ninja-style) ----------
// Per guest: resolution / fps / bitrate of what they send, switch their camera
// or mic, camera controls (zoom, focus, exposure…), mic gain and processing,
// live send stats, private message, deafen, reload, move to another room.
let remote = null; // { peerId, dlg, stats timer, snapshot }
const req = (target, action, value) => sig.send({ type: "request", target, action, ...(value === undefined ? {} : { value }) });

function openRemote(peerId) {
  closeRemote();
  const p = peers.get(peerId);
  if (!p) return toast("Ese invitado ya no está", "err");
  const dlg = el("dialog", { class: "card devdialog remotedlg" });
  remote = { peerId, dlg, snap: null };
  dlg.addEventListener("close", closeRemote);
  document.body.append(dlg);
  renderRemote();
  dlg.showModal();
  req(peerId, "devices");
  req(peerId, "stats");
  remote.timer = setInterval(() => { if (peers.has(peerId)) req(peerId, "stats"); }, 2000);
}
function closeRemote() {
  if (!remote) return;
  clearInterval(remote.timer);
  const d = remote.dlg; remote = null;
  if (d.open) d.close();
  d.remove();
}

sig.on("report", (m) => {
  if (m.action === "quality" && m.value?.stream) {
    const source = sources.get(m.value.stream);
    if (source) { source.sendHeight = m.value.quality; toast(`Calidad aplicada: ${m.value.width}×${m.value.height}`, "ok"); }
  }
  if (!remote || m.peerId !== remote.peerId) return;
  if (m.action === "devices" || m.action === "quality") { remote.snap = m.value; renderRemote(); if (m.action === "quality") toast("Calidad aplicada", "ok"); }
  if (m.action === "stats") {
    const s = m.value || {};
    const lim = { cpu: "limitado por CPU", bandwidth: "limitado por ancho de banda", other: "limitado" }[s.limit] || "";
    const line = s.width ? `${s.width}×${s.height} · ${s.fps} fps · ${s.videoKbps} kbps video · ${s.audioKbps || 0} kbps audio · ${String(s.codec || "").replace("video/", "")}${s.rtt != null ? ` · ${s.rtt} ms` : ""}${s.lost ? ` · ${s.lost} perdidos` : ""}${lim ? " · ⚠️ " + lim : ""}`
      : (s.connected ? "Sin video enviándose" : "No está publicando");
    const box = remote.dlg.querySelector(".rstats");
    if (box) box.textContent = line;
  }
});

function renderRemote() {
  const { peerId, dlg, snap } = remote;
  const p = peers.get(peerId) || { name: "Invitado" };
  const s = snap || {};
  const sel = (items, value) => { const x = el("select", {}, ...items.map(([v, t]) => el("option", { value: v, text: t }))); x.value = String(value ?? ""); return x; };
  const q = sel(QUALITIES, s.quality || "720");
  const fps = sel(FPS.map((f) => [f, f + " fps"]), s.fps || "30");
  const kbps = el("input", { type: "number", min: 0, max: 50000, step: 100, value: s.kbps || kbpsFor(Number(s.quality || 720)), title: "0 = automático según resolución" });
  q.onchange = () => { kbps.value = kbpsFor(Number(q.value)); };
  const presets = [["Baja (360p)", 360, 30, 800], ["Media (720p)", 720, 30, 2500], ["Alta (1080p)", 1080, 30, 6000], ["Máxima (1080p60)", 1080, 60, 9000]]
    .map(([t, h, f, k]) => el("button", { class: "small", onclick: () => { q.value = String(h); fps.value = String(f); kbps.value = k; applyQ(); }, text: t }));
  const applyQ = () => req(peerId, "quality", { height: Number(q.value), fps: Number(fps.value), kbps: Number(kbps.value) });

  const cam = sel([...(s.cams || []).map((d) => [d.id, d.label])], s.camera);
  cam.onchange = () => req(peerId, "device", { kind: "video", deviceId: cam.value });
  const mic = sel([...(s.mics || []).map((d) => [d.id, d.label])], s.mic);
  mic.onchange = () => req(peerId, "device", { kind: "audio", deviceId: mic.value });

  const gain = el("input", { type: "range", min: 0, max: 400, step: 5, value: s.gain ?? 100 });
  const gainLbl = el("span", { class: "muted", text: `${s.gain ?? 100}%` });
  gain.oninput = () => { gainLbl.textContent = gain.value + "%"; };
  gain.onchange = () => req(peerId, "gain", Number(gain.value));
  const chk = (k, text) => el("label", { class: "row" }, el("input", { type: "checkbox", checked: !!s[k], onchange: (e) => req(peerId, "audio", { [k]: e.target.checked }) }), " " + text);

  const camctl = el("div", { class: "col" });
  const names = { zoom: "Zoom", focusDistance: "Enfoque", exposureCompensation: "Exposición", exposureTime: "Tiempo de exposición", colorTemperature: "Temperatura de color", brightness: "Brillo", contrast: "Contraste", saturation: "Saturación", sharpness: "Nitidez", pan: "Pan", tilt: "Tilt", focusMode: "Modo de enfoque", exposureMode: "Modo de exposición", whiteBalanceMode: "Balance de blancos", torch: "Linterna", backgroundBlur: "Desenfoque del sistema" };
  for (const [k, c] of Object.entries(s.caps || {})) {
    if (Array.isArray(c)) {
      if (c.every((x) => typeof x === "boolean")) {
        camctl.append(el("label", { class: "row" }, el("input", { type: "checkbox", checked: !!s.cur?.[k], onchange: (e) => req(peerId, "camctl", { name: k, value: e.target.checked }) }), " " + (names[k] || k)));
      } else {
        const x = sel(c.map((v) => [v, v]), s.cur?.[k] ?? c[0]);
        x.onchange = () => req(peerId, "camctl", { name: k, value: x.value });
        camctl.append(el("div", {}, el("label", { text: names[k] || k }), x));
      }
    } else {
      const r = el("input", { type: "range", min: c.min, max: c.max, step: c.step || (c.max - c.min) / 100, value: s.cur?.[k] ?? c.min });
      r.onchange = () => req(peerId, "camctl", { name: k, value: Number(r.value) });
      camctl.append(el("div", {}, el("label", { text: names[k] || k }), r));
    }
  }

  const msg = el("input", { maxlength: 500, placeholder: "Mensaje privado que verá en pantalla" });
  const sendMsg = () => { if (msg.value.trim()) { req(peerId, "message", msg.value.trim()); msg.value = ""; toast("Mensaje enviado", "ok"); } };
  msg.addEventListener("keydown", (e) => e.key === "Enter" && sendMsg());

  dlg.replaceChildren(
    el("div", { class: "row" }, el("h3", { class: "grow", style: "margin:0", text: `🎛️ ${p.name}` }), el("button", { class: "small", onclick: closeRemote, text: "✕" })),
    el("div", { class: "rstats muted", text: "Leyendo estadísticas…" }),
    el("h4", { text: "Calidad de lo que envía" }),
    el("div", { class: "row wrap" }, ...presets),
    el("div", { class: "row" }, el("div", { class: "grow" }, el("label", { text: "Resolución" }), q), el("div", {}, el("label", { text: "FPS" }), fps), el("div", {}, el("label", { text: "Bitrate (kbps)" }), kbps)),
    el("button", { class: "primary", onclick: applyQ, text: "Aplicar calidad" }),
    s.width ? el("p", { class: "muted", style: "margin:0;font-size:12px", text: `Cámara entrega ${s.width}×${s.height} a ${s.frameRate} fps${s.effect && s.effect !== "none" ? " · con efecto de video" : ""}` }) : null,
    el("h4", { text: "Dispositivos" }),
    snap ? el("div", { class: "col" },
      el("div", {}, el("label", { text: "📷 Cámara" }), (s.cams || []).length ? cam : el("p", { class: "muted", text: "Sin cámaras" })),
      el("div", {}, el("label", { text: "🎙️ Micrófono" }), (s.mics || []).length ? mic : el("p", { class: "muted", text: "Sin micrófonos" })),
      el("div", {}, el("label", { text: "Ganancia " }, gainLbl), gain),
      el("div", { class: "row wrap" }, chk("echo", "Eco"), chk("denoise", "Ruido"), chk("autogain", "Ganancia auto"), chk("stereo", "Estéreo HQ")),
      camctl.children.length ? el("details", { class: "camdetails" }, el("summary", { text: "🎛️ Controles de su cámara" }), camctl) : null)
      : el("p", { class: "muted", text: "Pidiendo la lista de dispositivos…" }),
    el("h4", { text: "Acciones" }),
    el("div", { class: "row" }, msg, el("button", { class: "small", onclick: sendMsg, text: "Enviar" })),
    el("div", { class: "row wrap" },
      el("button", { class: "small", onclick: () => req(peerId, p.mic === false ? "unmute" : "mute"), text: p.mic === false ? "🎙️ Pedir audio" : "🔇 Silenciar mic" }),
      el("button", { class: "small", onclick: () => req(peerId, p.cam === false ? "camon" : "camoff"), text: p.cam === false ? "📷 Pedir cámara" : "📷 Apagar cámara" }),
      el("button", { class: "small", onclick: () => req(peerId, "screenon"), text: "🖥️ Pedir pantalla" }),
      el("button", { class: "small", onclick: () => req(peerId, "deafen"), text: "🙉 Que no escuche" }),
      el("button", { class: "small", onclick: () => req(peerId, "undeafen"), text: "👂 Que escuche" }),
      el("button", { class: "small", onclick: () => confirm(`¿Recargar la página de ${p.name}?`) && req(peerId, "reload"), text: "🔄 Recargar" }),
      el("button", { class: "small", onclick: () => { const to = prompt("ID de la sala de destino (debe existir)"); if (to) req(peerId, "transfer", to.trim().toLowerCase()); }, text: "➡️ Mover a otra sala" }),
      el("button", { class: "small danger", onclick: () => confirm(`¿Expulsar a ${p.name}?`) && (sig.send({ type: "kick", target: peerId }), closeRemote()), text: "🚫 Expulsar" })),
  );
}
sig.on("peer-left", (m) => { if (remote?.peerId === m.peerId) { closeRemote(); } });

// ---------- invite link builder (VDO.Ninja URL options) ----------
function inviteURL() {
  const q = new URLSearchParams({ room });
  const v = (id) => $(id)?.value;
  if (v("#invQuality")) q.set("height", v("#invQuality"));
  if (v("#invBitrate")) q.set("bitrate", v("#invBitrate"));
  if (v("#invCodec")) q.set("codec", v("#invCodec"));
  if (v("#invEffect")) q.set("effects", v("#invEffect"));
  if ($("#invMuted")?.checked) q.set("muted", "1");
  if ($("#invVideoMute")?.checked) q.set("videomute", "1");
  if ($("#invStereo")?.checked) q.set("stereo", "1");
  if ($("#invAudioOnly")?.checked) q.set("novideo", "1");
  // The invite key (in the #hash, never sent to servers or logs) lets these
  // guests skip the waiting room and land straight in the backstage.
  return `${origin()}/guest?${q}` + (keys.inviteKey ? `#invite=${encodeURIComponent(keys.inviteKey)}` : "");
}
function renderInvite() { const i = $("#invURL"); if (i) i.value = inviteURL(); }
$$("#inviteOpts select, #inviteOpts input[type=checkbox], #inviteOpts input[type=number]").forEach((x) => x.addEventListener("change", renderInvite));
$("#invCopy").onclick = () => copy(inviteURL());
renderInvite();

window.addEventListener("pagehide", e => { if (!e.persisted) { studioWorkspace.destroy(); telemetry.destroy(); cinema.destroy(); comp.stop(); scenePrev.stop(); roomAudio.close(); } });
let restoringHostCapture = false;
const resumeStudioAudio = async () => {
  if (document.visibilityState !== "visible") return;
  roomAudio.resume(); mixer.ctx.resume().catch(() => {}); levelMeter.ctx?.resume().catch(() => {});
  for (const source of sources.values()) source.video?.play().catch(() => {});
  if (restoringHostCapture || !sig.ready || sig.closed) return;
  const source = hostCamId && sources.get(hostCamId);
  if (!source?.local) return;
  restoringHostCapture = true;
  try {
    for (const kind of ["audio", "video"]) {
      const tracks = kind === "audio" ? source.stream.getAudioTracks() : source.stream.getVideoTracks();
      if (tracks.some(t => t.readyState === "ended")) await onPrefChange(prefs, kind, true);
    }
  } catch (e) { if (!sig.closed) toast(`No se pudo recuperar el dispositivo: ${explain(e)}`, "err"); }
  finally { restoringHostCapture = false; }
};
document.addEventListener("visibilitychange", resumeStudioAudio);
document.addEventListener("pointerdown", resumeStudioAudio, true);
window.addEventListener("pageshow", resumeStudioAudio);

// Persistence is opt-in and host-only. Server state saves as it changes;
// these controls also retain local production settings without extending TTL.
let persistence = null, optionsSaveTimer = null;
const optionIDs = ["obsQuality","obsFPS","obsCover","obsMute","obsLabel","obsTransparent","vKbps","fps","invQuality","invBitrate","invCodec","invEffect","invMuted","invVideoMute","invStereo","invAudioOnly"];
function roomOptions() {
  return { controls: Object.fromEntries(optionIDs.map(id => { const e=$("#"+id); return [id,e.type === "checkbox" ? e.checked : e.value]; })), prefs, dests, monitorOn, editScene };
}
function renderPersistence(info, restore = false) {
  persistence = info;
  $("#persistSave").disabled = !info.available || !info.password;
  $("#passwordRoomHelp").classList.toggle("hidden",info.password || !info.available);
  $("#roomActionLabel").textContent=info.enabled ? "Sala guardada" : "Guardar sala";
  $("#openRoomDialog").classList.toggle("is-saved",info.enabled);
  $("#roomSavedState").textContent=info.enabled ? "Sala persistente" : "Sala temporal";
  $("#roomSavedState").classList.toggle("green",info.enabled);
  $("#persistSave").textContent=info.enabled ? "Guardar y renovar" : "Guardar sala";
  $("#openRoomDialog").title=info.enabled ? (info.expires ? "Guardada hasta " + new Date(info.expires).toLocaleString() : "Guardada sin caducidad") : "Guardar ajustes, participantes y enlaces de OBS";
  $("#persistForget").classList.toggle("hidden", !info.enabled);
  $("#persistStatus").textContent = !info.available ? "El servidor no tiene almacenamiento configurado." : !info.password ? "Esta sala no tiene contraseña. Crea un estudio con contraseña desde la portada para habilitar el guardado." : !info.enabled ? "Esta sala todavía no está guardada." : info.expires ? "Guardada hasta " + new Date(info.expires).toLocaleString() : "Guardada sin caducidad.";
  if (restore && info.enabled) {
    $("#persistDays").value = String(info.days);
    const opt=info.options || {};
    for (const id of optionIDs) if (Object.hasOwn(opt.controls || {}, id)) {
      const e=$("#"+id); if (e.type === "checkbox") e.checked=!!opt.controls[id]; else e.value=String(opt.controls[id]);
    }
    if (opt.prefs && typeof opt.prefs === "object") Object.assign(prefs,opt.prefs);
    if (Array.isArray(opt.dests)) { dests=opt.dests; saveDests(); }
    if (typeof opt.monitorOn === "boolean") { monitorOn=opt.monitorOn; syncMonitor(); }
    if (SCENES.includes(opt.editScene)) editScene=opt.editScene;
    renderObs(); renderInvite();
  }
  savedRooms[room]={...savedRooms[room], persistent:info.enabled, expires:info.expires, title:state.title};
  writeStored("swr.rooms",savedRooms);
  const box=$("#persistentParticipants"); box.replaceChildren();
  if (!info.enabled) return;
  for (const [pass,name] of Object.entries(info.participants || {})) {
    const fragment=new URLSearchParams({invite:keys.inviteKey,participant:pass});
    const url=`${origin()}/guest?room=${encodeURIComponent(room)}&label=${encodeURIComponent(name)}#${fragment}`;
    box.append(el("div",{class:"row"},el("span",{class:"grow",text:name}),el("button",{class:"small",text:"Enlace personal",onclick:()=>copy(url)})));
  }
  for (const [id,source] of Object.entries(info.sources || {})) {
    box.append(el("div",{class:"row"},el("span",{class:"grow",text:state.labels?.[id] || source.kind || id}),el("button",{class:"small",text:"Link OBS guardado",onclick:()=>copy(obsURL(id))})));
  }
}
sig.on("persistence",m=>renderPersistence(m.persistence));
async function saveRoomOptions(action="") {
  const response=await fetch(`/api/rooms/${encodeURIComponent(room)}/persistence${action === "options" ? "?auto=1" : ""}`,{method:"POST",signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json",Authorization:"Bearer "+hostKey},body:JSON.stringify({days:Number($("#persistDays").value),options:roomOptions()})});
  const result=await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo guardar la sala");
  renderPersistence(result);
}
$("#persistSave").onclick=async()=>{
  const btn=$("#persistSave");btn.disabled=true;btn.textContent="Guardando…";
  try { await saveRoomOptions(); toast("Sala y ajustes guardados"); } catch(e) { toast(e.message,"err"); }
  finally { if (persistence) renderPersistence(persistence); }
};
$("#persistForget").onclick=async()=>{ try { await sig.request({type:"forget-room"}); toast("Persistencia desactivada; la sala actual sigue abierta"); } catch(e) { toast(e.message,"err"); } };
function scheduleRoomOptions() {
  if (!persistence?.enabled) return;
  clearTimeout(optionsSaveTimer);
  optionsSaveTimer=setTimeout(()=>saveRoomOptions("options").catch(e=>toast(e.message,"err")),500);
}
for (const id of optionIDs) $("#"+id).addEventListener("change",scheduleRoomOptions);

const roomDialog=$("#roomDialog");
for (const id of ["openRoomDialog","roomDetails"]) $("#"+id).onclick=()=>{
  if (persistence) $("#persistDays").value=String(persistence.enabled ? persistence.days : 30);
  if (!roomDialog.open) roomDialog.showModal();
};
$("#closeRoomDialog").onclick=()=>roomDialog.close();
$("#copyHostLink").onclick=()=>copy(`${origin()}/studio?room=${encodeURIComponent(room)}#key=${encodeURIComponent(hostKey)}`);
