// Guest page: pre-join device check, then join the room (VDO.Ninja-style "push").
// URL options (VDO.Ninja compatible where it makes sense):
//   &label= / &name=        prefill (and with &autostart, skip) the name
//   &autostart / &autojoin  join right away
//   &password= / &pw=       room password
//   &webcam / &screenshare  start with camera (default) or with screen share
//   &muted / &videomute     join with mic or camera off
//   &bitrate= (kbps)        video bitrate · &codec=h264|vp8|vp9|av1
//   &quality=0|1|2 or &height=, &fps=, &stereo, &denoise=0, &echo=0, &autogain=0
//   &videodevice= &audiodevice= &outputdevice=  index (1..n), part of the name, or 0 = off
//   &novideo / &noaudio     audio-only / video-only
import { $, el, toast, params, api, Signal, publish, subscribe, levelMeter } from "./rtc.js";
import { listDevices, openScreen, loadPrefs, savePrefs, openMedia, renderPanel, cameraControls, applySink, onDeviceChange, settingsDialog, kbpsFor, explain } from "./devices.js";
import { remoteSnapshot, remoteStats, CAMCTL } from "./remote.js";
import { chatMessage, appendChat, mountComposer } from "./chat.js";
import { automaticRoute } from "./network.js";

const room = (params.get("room") || "").toLowerCase();
if (!room) location.href = "/";
const prefs = loadPrefs();
let media = new MediaStream(), pub = null, screenPub = null, screenMedia = null;
const extraCams = new Map(); // pubId -> { pub, media }
let state = {};
const remotes = new Map(); // streamId -> { tile, sub, video }
const sig = new Signal();
// Even previously shared links start automatically. Manual routing is an
// optional advanced action for this visit, never required for admission.
sig.mediaMode = "auto";
$("#networkMode").value = sig.mediaMode;
function selectNetwork(mode) {
  $("#networkMode").value = mode;
  const url = new URL(location.href);
  if (mode === "auto") url.searchParams.delete("network"); else url.searchParams.set("network", mode);
  history.replaceState(null, "", url);
  sig.useNetwork(mode);
  if (entered) connectionStatus("Cambiando la ruta de audio y video…");
}
$("#networkMode").onchange = () => selectNetwork($("#networkMode").value);
let myId = "";

let savedName = "";
try { savedName = localStorage.getItem("swr.name") || ""; } catch {}
$("#name").value = params.get("label") || params.get("name") || savedName;
if (params.get("password") || params.get("pw")) $("#pw").value = params.get("password") || params.get("pw");

// ---------- pre-join ----------
api(`/api/rooms/${encodeURIComponent(room)}`).then((r) => {
  $("#roomTitle").textContent = r.title ? `Unirse a “${r.title}”` : "Unirse al programa";
  $("#pwBox").classList.toggle("hidden", !r.password);
}).catch(() => { $("#roomTitle").textContent = "Esta sala no existe o ya terminó"; $("#joinBtn").disabled = true; });

let remoteKbps = 0; // set by the host (director) from the studio
const videoKbps = () => remoteKbps || Number(params.get("bitrate") || params.get("vb")) || kbpsFor(Number(prefs.quality));
const pubOpts = (name) => ({ kind: "camera", name, videoKbps: videoKbps(), fps: Number(prefs.fps) || 30, codec: prefs.codec, stereo: prefs.stereo, audioKbps: prefs.stereo ? 256 : 96 });

let meterTimer;
function showMeter(stream) {
  clearInterval(meterTimer);
  const lvl = levelMeter(stream);
  meterTimer = setInterval(() => { $("#meter").style.width = Math.round(lvl() * 100) + "%"; }, 80);
}

function mirrorPreview(v) { v.style.transform = prefs.mirror ? "scaleX(-1)" : ""; }

async function open(kinds = "all") {
  const { stream, warnings } = await openMedia(prefs);
  $("#devWarn").textContent = warnings.join(" ");
  warnings.forEach((w) => toast(w, "err"));
  if (kinds === "all") return stream;
  return stream;
}

async function startPreview() {
  // Show the selectors right away (labels fill in once permission is granted).
  if (!$("#devPre").children.length) await renderPanel($("#devPre"), prefs, onPrefChange);
  media.getTracks().forEach((t) => t.stop());
  media = await open();
  if (!media.getTracks().length && !$("#devWarn").textContent) $("#devWarn").textContent = "No se detectó cámara ni micrófono. Puedes entrar igual para ver y chatear.";
  $("#preview").srcObject = media; mirrorPreview($("#preview"));
  showMeter(media);
  await renderPanel($("#devPre"), prefs, onPrefChange);
  $("#camCtlPre").replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
}

async function onPrefChange(p, what) {
  if (what === "speaker") { for (const r of remotes.values()) applySink(r.video, p.speaker); return; }
  if (what === "other") {
    mirrorPreview($("#preview"));
    const me = $('[data-id="me"] video'); if (me) mirrorPreview(me);
    return;
  }
  if (!pub) return startPreview(); // still in pre-join: just reopen everything
  await swapDevices(what);
}

/** Hot-swap camera or mic during the call (no reconnection, no renegotiation). */
async function swapDevices(what, quiet = false) {
  const kind = what === "video" ? "video" : "audio";
  const opened = await openMedia({ ...prefs, camera: kind === "video" ? prefs.camera : "none", mic: kind === "audio" ? prefs.mic : "none" });
  opened.warnings.forEach((w) => toast(w, "err"));
  const fresh = kind === "video" ? opened.stream.getVideoTracks()[0] : opened.stream.getAudioTracks()[0];
  const old = kind === "video" ? media.getVideoTracks()[0] : media.getAudioTracks()[0];
  const wasOn = old ? old.enabled : true;
  if (fresh) fresh.enabled = wasOn;
  if (old) { media.removeTrack(old); old.stop(); }
  if (fresh) media.addTrack(fresh);
  if (pub && !(await pub.replaceTrack(kind, fresh || null)) && fresh) {
    // The original publication had no track of this kind: republish once.
    pub.stop(); pub = await publish(sig, media, pubOpts($("#name").value));
  }
  if (kind === "video" && pub) await pub.setBitrate(videoKbps(), Number(prefs.fps) || 30);
  const me = $('[data-id="me"] video'); if (me) { me.srcObject = media; mirrorPreview(me); }
  if (kind === "audio") showMeter(media);
  $("#devCamCtl")?.replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
  sendMedia();
  if (!quiet) toast(kind === "video" ? "Cámara cambiada" : "Micrófono cambiado", "ok");
}

onDeviceChange(() => {
  const target = $("#devDialog")?.open ? $("#devPanel") : $("#pre").classList.contains("hidden") ? null : $("#devPre");
  if (target) renderPanel(target, prefs, onPrefChange);
});
startPreview();

$("#joinBtn").onclick = join;
async function join() {
  const name = $("#name").value.trim();
  if (!name) return toast("Escribe tu nombre", "err");
  try { localStorage.setItem("swr.name", name); } catch {}
  $("#joinBtn").disabled = true;
  $("#networkMode").disabled = true;
  try {
    if (sig.mediaMode === "auto") {
      const cfg = await api("/api/config");
      sig.mediaMode = await automaticRoute(cfg, mode => {
        $("#joinBtn").textContent = mode === "local" ? "Comprobando la conexión alternativa…" : "Comprobando la mejor conexión…";
      });
    }
    $("#joinBtn").textContent = "Entrando…";
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
    const m = await sig.connect({ type: "join", room, role: "guest", name, password: $("#pw").value, invite });
    if (m.type === "waiting") { $("#pre").classList.add("hidden"); $("#waiting").classList.remove("hidden"); return; }
    await enter(m);
  } catch (e) {
    toast(e.message, "err");
    $("#joinBtn").disabled = false;
    $("#networkMode").disabled = false;
    $("#joinBtn").textContent = "Entrar";
  }
}
if ((params.has("autostart") || params.has("autojoin") || params.has("aj")) && $("#name").value) setTimeout(join, 800);

let entered = false, rewait = false;
let connectingMedia = false;
let mediaGeneration = 0, reconnectingGuest = false;
function connectionStatus(text, retry = false) {
  $("#connection").classList.toggle("hidden", !text);
  $("#connectionText").textContent = text;
  $("#retryMedia").classList.toggle("hidden", !retry);
  $("#retryTLS").classList.toggle("hidden", !retry || sig.mediaMode === "tls");
  $("#retryLocal").classList.toggle("hidden", !retry || sig.mediaMode === "local" || !sig.localIce.length);
}
async function connectMedia() {
  if (connectingMedia) return;
  if (!media.getTracks().length) { connectionStatus(""); return; }
  const generation = ++mediaGeneration;
  connectingMedia = true;
  $("#retryMedia").disabled = true;
  connectionStatus("Conectando audio y video…");
  try {
    pub?.stop(); pub = null;
    const fresh = await publish(sig, media, pubOpts($("#name").value));
    if (generation !== mediaGeneration) { fresh.stop(); return; }
    pub = fresh;
    connectionStatus(""); sendMedia(); updateStageBadge();
    const current = pub;
    pub.pc.addEventListener("connectionstatechange", () => {
      if (pub !== current) return;
      if (pub.pc.connectionState === "connected") connectionStatus("");
      else if (["failed", "disconnected"].includes(pub.pc.connectionState)) connectionStatus("Se perdió la conexión de audio y video. Puedes volver a conectarte.", true);
    });
  } catch (e) { if (generation === mediaGeneration) connectionStatus(e.message, true); }
  finally { if (generation === mediaGeneration) { connectingMedia = false; $("#retryMedia").disabled = false; } }
}
async function reconnectGuest() {
  if (reconnectingGuest || sig.closed) return;
  reconnectingGuest = true; $("#retryMedia").disabled = true;
  connectionStatus("Comprobando la conexión para volver a entrar…");
  try {
    await sig.reconnect(async () => {
      const cfg = await api("/api/config");
      sig.mediaMode = await automaticRoute(cfg, mode => connectionStatus(mode === "local" ? "Comprobando la conexión alternativa…" : "Comprobando la mejor conexión…"));
      if (media.getTracks().length && media.getTracks().every(t => t.readyState === "ended")) {
        const mic = micOn(), cam = camOn();
        media = await open();
        media.getAudioTracks().forEach(t => { t.enabled = mic; });
        media.getVideoTracks().forEach(t => { t.enabled = cam; });
        const me = $('[data-id="me"] video'); if (me) me.srcObject = media;
      }
    });
  } catch (e) { connectionStatus(`No se pudo reconectar: ${e.message}`, true); }
  finally { reconnectingGuest = false; $("#retryMedia").disabled = false; }
}
$("#retryMedia").onclick = reconnectGuest;
$("#retryTLS").onclick = () => selectNetwork("tls");
$("#retryLocal").onclick = () => selectNetwork("local");
sig.on("disconnected", () => {
  ++mediaGeneration; connectingMedia = false;
  if (sig.closed) return; // Leave/kick already replaced the call's DOM.
  $("#retryMedia").disabled = reconnectingGuest;
  try { pub?.pc.close(); } catch {} pub = null;
  for (const id of [...remotes.keys()]) unwatch(id);
  if (entered) connectionStatus("Reconectando con el servidor…", !reconnectingGuest);
});
sig.on("welcome", (m) => {
  if (rewait) { rewait = false; $("#waiting").classList.add("hidden"); $("#call").classList.remove("hidden"); resume(m); return; }
  if (!entered && !$("#waiting").classList.contains("hidden")) enter(m);
});
sig.on("denied", () => { document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card" }, el("h2", { text: "El anfitrión no aprobó tu ingreso." })))); });
sig.on("kicked", () => { sig.close(); leave("El anfitrión te retiró de la sala."); });
sig.on("reconnected", (m) => {
  if (!entered) return; // still in the waiting room: the server re-sent "waiting" and the host sees the knock again
  if (m.type === "waiting") { // the server forgot us (e.g. it restarted): wait to be let back in
    rewait = true;
    $("#call").classList.add("hidden"); $("#waiting").classList.remove("hidden");
    return;
  }
  resume(m);
});
async function resume(m) {
  // The server forgot our old publications: publish fresh ones.
  myId = m.peerId;
  state = m.state || state;
  try { pub?.pc.close(); } catch {}
  pub = null;
  await connectMedia();
  if (screenPub) { try { screenPub.pc.close(); } catch {} screenPub = await publish(sig, screenMedia, { kind: "screen", name: $("#name").value + " · pantalla", videoKbps: 5000, contentHint: "detail" }).catch(() => null); }
  for (const [id, x] of extraCams) { try { x.pub.pc.close(); } catch {} extraCams.delete(id); x.media.getTracks().forEach((t) => t.stop()); }
  for (const id of [...remotes.keys()]) unwatch(id);
  for (const s of m.streams || []) watch(s.id, s.kind, s.owner);
  $("#chatlog").replaceChildren(); for (const c of m.chat || []) addChat(c); // catch up on what we missed
  sendMedia();
}

async function enter(m) {
  if (entered) return;
  entered = true;
  myId = m.peerId;
  state = m.state || {};
  $("#pre").classList.add("hidden"); $("#waiting").classList.add("hidden"); $("#call").classList.remove("hidden");
  clearInterval(meterTimer);
  if (params.has("muted") || params.has("mute")) media.getAudioTracks().forEach((t) => (t.enabled = false));
  if (params.has("videomute") || params.has("vm")) media.getVideoTracks().forEach((t) => (t.enabled = false));
  addTile("me", media, $("#name").value + " (tú)", true, levelMeter(media));
  await connectMedia();
  setMic(micOn()); setCam(camOn());
  for (const s of m.streams || []) watch(s.id, s.kind, s.owner);
  for (const c of m.chat || []) addChat(c);
  updateStageBadge();
  if (params.has("screenshare") || params.has("ss")) $("#screenBtn").click();
}

// ---------- remote media ----------
sig.on("stream-added", (m) => watch(m.info.id, m.info.kind, m.info.owner, m.name));
sig.on("stream-removed", (m) => unwatch(m.stream));
sig.on("state", (m) => { state = m.state; updateStageBadge(); });
sig.on("chat", (m) => addChat(m.comment));
sig.on("reaction", (m) => fly(m.text));
sig.on("request", (m) => {
  switch (m.action) {
    case "mute": setMic(false); toast("El anfitrión silenció tu micrófono"); break;
    case "unmute": ask("El anfitrión te pide activar el micrófono", "Activar", () => setMic(true)); break;
    case "camoff": setCam(false); toast("El anfitrión apagó tu cámara"); break;
    case "camon": ask("El anfitrión te pide encender la cámara", "Encender", () => setCam(true)); break;
    case "lowerhand": $("#handBtn").classList.remove("on"); break;
    case "screenoff": if (screenPub) stopScreen(); toast("El anfitrión detuvo tu pantalla compartida"); break;
    case "screenon": if (!screenPub) ask("El anfitrión te pide compartir tu pantalla", "Compartir", () => $("#screenBtn").click()); break;
    default: remoteControl(m.action, m.value).catch((e) => toast(e.message, "err"));
  }
});

// ---------- director remote control (VDO.Ninja-style) ----------
// The host can tune what we send (resolution, fps, bitrate), switch our camera
// or mic among the devices we already allowed, adjust camera controls (zoom,
// focus, exposure...), mic gain and processing, and read live stats. Turning a
// camera or mic ON still needs the guest's click (see ask()).
const report = (action, value) => sig.send({ type: "report", action, value });
let deafened = false;
async function remoteControl(action, v) {
  const camTrack = () => { const t = media.getVideoTracks()[0]; return t?.raw || t; };
  switch (action) {
    case "devices":
      return report("devices", await remoteSnapshot(media, prefs, { videoKbps: videoKbps() }));
    case "stats":
      return report("stats", await remoteStats(pub));
    case "quality": {
      const h = Number(v?.height), fps = Number(v?.fps), kbps = Number(v?.kbps);
      if (h && h >= 144 && h <= 2160) prefs.quality = String(h);
      if (fps && fps >= 1 && fps <= 60) prefs.fps = String(fps);
      remoteKbps = kbps >= 50 && kbps <= 50000 ? Math.round(kbps) : (v?.kbps === 0 ? 0 : remoteKbps);
      const t = camTrack();
      let ok = false;
      if (t && t.applyConstraints) { // with effects this is the raw camera; the effect canvas follows its size
        try {
          await t.applyConstraints({ width: { ideal: Math.round(Number(prefs.quality) * 16 / 9) }, height: { ideal: Number(prefs.quality) }, frameRate: { ideal: Number(prefs.fps) } });
          ok = true;
        } catch (e) { console.warn("applyConstraints", e); }
      }
      if (!ok && t) await swapDevices("video", true);
      if (pub) await pub.setBitrate(videoKbps(), Number(prefs.fps) || 30);
      savePrefs(prefs);
      toast(`El anfitrión ajustó tu video: ${prefs.quality}p · ${prefs.fps} fps · ${videoKbps()} kbps`);
      return report("quality", await remoteSnapshot(media, prefs, { videoKbps: videoKbps() }));
    }
    case "device": {
      const kind = v?.kind === "audio" ? "audio" : "video";
      const { cams, mics } = await listDevices();
      const list = kind === "video" ? cams : mics;
      if (!list.some((d) => d.deviceId === v?.deviceId)) throw new Error("Dispositivo no encontrado");
      if (kind === "video") prefs.camera = v.deviceId; else prefs.mic = v.deviceId;
      savePrefs(prefs);
      await swapDevices(kind, true);
      toast(kind === "video" ? "El anfitrión cambió tu cámara" : "El anfitrión cambió tu micrófono");
      return report("devices", await remoteSnapshot(media, prefs, { videoKbps: videoKbps() }));
    }
    case "camctl": {
      const t = camTrack();
      if (!t || !CAMCTL.includes(v?.name)) throw new Error("Control de cámara no disponible");
      await t.applyConstraints({ advanced: [{ [v.name]: v.value }] });
      return;
    }
    case "gain": {
      const g = Number(v);
      if (!(g >= 0 && g <= 400)) return;
      prefs.gain = Math.round(g); savePrefs(prefs);
      await swapDevices("audio", true);
      return toast(`El anfitrión ajustó tu micrófono a ${prefs.gain}%`);
    }
    case "audio": {
      for (const k of ["echo", "denoise", "autogain", "stereo"]) if (typeof v?.[k] === "boolean") prefs[k] = v[k];
      savePrefs(prefs);
      return swapDevices("audio", true);
    }
    case "deafen": case "undeafen":
      deafened = action === "deafen";
      for (const r of remotes.values()) if (r.video) r.video.muted = deafened;
      return toast(deafened ? "El anfitrión silenció lo que escuchas (por ejemplo, para que no se acople)" : "Vuelves a escuchar la sala");
    case "message":
      return showHostMessage(String(v || "").slice(0, 500));
    case "reload": {
      const u = new URL(location.href);
      u.searchParams.set("label", $("#name").value); u.searchParams.set("autostart", "1");
      return location.replace(u.toString());
    }
    case "transfer": {
      const u = new URL(location.href);
      u.searchParams.set("room", String(v || "")); u.searchParams.set("label", $("#name").value); u.searchParams.set("autostart", "1");
      toast("El anfitrión te está moviendo a otra sala…");
      sig.close(); pub?.stop();
      return setTimeout(() => location.replace(u.toString()), 600);
    }
  }
}

function showHostMessage(text) {
  if (!text) return;
  const box = el("div", { class: "hostmsg" }, el("b", { text: "Mensaje del anfitrión" }), el("p", { text }), el("button", { class: "small primary", onclick: () => box.remove(), text: "Entendido" }));
  document.body.append(box);
  setTimeout(() => box.remove(), 30000);
}
sig.on("error", (m) => toast(m.error, "err"));

function ask(text, btn, fn) {
  // Privacy: the host can turn things off, but turning them on needs the guest's click.
  const box = el("div", { class: "toast ask" }, el("span", { text }), el("button", { class: "small primary", onclick: () => { fn(); box.remove(); }, text: btn }), el("button", { class: "small", onclick: () => box.remove(), text: "Ahora no" }));
  ($("#toasts") || document.body).append(box);
  setTimeout(() => box.remove(), 15000);
}

async function watch(id, kind, owner, name) {
  if (kind === "program" || owner === myId || remotes.has(id) || id === pub?.id || id === screenPub?.id || extraCams.has(id)) return;
  const pending = {};
  remotes.set(id, pending);
  try {
    const sub = await subscribe(sig, id);
    if (remotes.get(id) !== pending) { sub.close(); return; }
    const lvl = sub.stream.getAudioTracks().length ? levelMeter(sub.stream) : () => 0;
    const tile = addTile(id, sub.stream, sub.name || name || "Invitado", false, lvl);
    remotes.set(id, { sub, tile, video: tile.querySelector("video") });
  } catch { if (remotes.get(id) === pending) remotes.delete(id); }
}
function unwatch(id) {
  const r = remotes.get(id);
  r?.sub?.close(); r?.tile?.remove();
  remotes.delete(id);
}

function addTile(id, stream, name, mine, level) {
  const v = el("video", { playsinline: true, autoplay: true });
  v.muted = mine || deafened; v.srcObject = stream;
  if (mine) mirrorPreview(v); else applySink(v, prefs.speaker);
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); document.addEventListener("click", () => { v.muted = mine || deafened; v.play(); }, { once: true }); });
  const vol = mine ? null : el("input", { type: "range", min: 0, max: 1, step: 0.05, value: 1, title: "Volumen (solo para ti)", class: "tilevol", oninput: (e) => { v.volume = Number(e.target.value); } });
  const tile = el("div", { class: "tile", "data-id": id }, v, el("span", { class: "name", text: name }), vol);
  $("#grid").append(tile);
  const t = setInterval(() => { if (!tile.isConnected) return clearInterval(t); tile.classList.toggle("speaking", level() > 0.15); }, 150);
  return tile;
}

function updateStageBadge() {
  const mine = [pub?.id, screenPub?.id, ...extraCams.keys()].filter(Boolean);
  const live = mine.some((id) => (state.stage || []).includes(id));
  const progMuted = state.stageMuted || mine.some((id) => state.muted?.[id]);
  const others = Object.entries(state.outputs || {}).filter(([, o]) => mine.some((id) => (o.stage || []).includes(id))).map(([n]) => n);
  const b = $("#stageState");
  b.textContent = live ? (state.live ? "EN VIVO" : "en escenario") + (live && progMuted ? " · silenciado" : "") : others.length ? `en escena ${others.join(", ")}` : "backstage";
  b.className = "pill " + (live ? "red" : "");
}

// ---------- controls ----------
function setMic(on) {
  media?.getAudioTracks().forEach((t) => { t.enabled = on; if (t.raw) t.raw.enabled = on; });
  $("#micBtn").className = "icon " + (on ? "on" : "off");
  sendMedia();
}
function setCam(on) {
  media?.getVideoTracks().forEach((t) => (t.enabled = on));
  $("#camBtn").className = "icon " + (on ? "on" : "off");
  sendMedia();
}
const micOn = () => !!media?.getAudioTracks().some((t) => t.enabled);
const camOn = () => !!media?.getVideoTracks().some((t) => t.enabled);
function sendMedia() { if (pub) sig.send({ type: "media", mic: micOn(), cam: camOn() }); }

$("#micBtn").onclick = () => setMic(!micOn());
$("#camBtn").onclick = () => setCam(!camOn());
$("#handBtn").onclick = () => { sig.send({ type: "hand" }); $("#handBtn").classList.toggle("on"); };
$("#chatBtn").onclick = () => { $("#chat").classList.toggle("hidden"); $("#chatBtn").classList.remove("on"); };
$("#reactBtn").onclick = () => $("#reactions").classList.toggle("hidden");
for (const e of ["👏", "❤️", "😂", "🔥", "🎉", "👍"]) $("#reactions").append(el("button", { class: "small", onclick: () => sig.send({ type: "reaction", text: e }), text: e }));

$("#setBtn").onclick = async () => {
  const dlg = settingsDialog();
  await renderPanel($("#devPanel"), prefs, onPrefChange);
  $("#devCamCtl").replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
  dlg.showModal();
};

function stopScreen() {
  screenPub?.stop(); screenMedia?.getTracks().forEach((t) => t.stop());
  screenPub = null; screenMedia = null; $("#screenBtn").classList.remove("on");
}
$("#screenBtn").onclick = async () => {
  if (screenPub) return stopScreen();
  try {
    screenMedia = await openScreen();
    screenPub = await publish(sig, screenMedia, { kind: "screen", name: $("#name").value + " · pantalla", videoKbps: 5000, contentHint: "detail", codec: prefs.codec, stereo: true, audioKbps: 192 });
    $("#screenBtn").classList.add("on");
    screenMedia.getVideoTracks()[0].onended = stopScreen;
  } catch (e) { if (e.name !== "NotAllowedError" && e.name !== "AbortError") toast(e.name === "NotSupportedError" ? e.message : explain(e), "err"); }
};

// A second (third…) camera from the same device, e.g. overhead cam or capture card.
$("#cam2Btn").onclick = async () => {
  const { cams } = await listDevices();
  const used = media.getVideoTracks()[0]?.getSettings().deviceId;
  const options = cams.filter((c) => c.deviceId !== used);
  if (!options.length) return toast("No hay otra cámara conectada.", "err");
  const dlg = el("dialog", { class: "card devdialog" },
    el("h3", { text: "Agregar otra cámara" }),
    ...options.map((c, i) => el("button", { onclick: async () => { dlg.close(); dlg.remove(); await addExtraCam(c); }, text: c.label || `Cámara ${i + 2}` })),
    el("button", { class: "small", onclick: () => { dlg.close(); dlg.remove(); }, text: "Cancelar" }));
  document.body.append(dlg); dlg.showModal();
};
async function addExtraCam(dev) {
  const { stream, warnings } = await openMedia({ ...prefs, camera: dev.deviceId, mic: "none" });
  warnings.forEach((w) => toast(w, "err"));
  if (!stream.getVideoTracks().length) return;
  const name = `${$("#name").value} · ${(dev.label || "cámara 2").slice(0, 24)}`;
  const p = await publish(sig, stream, { ...pubOpts(name), name });
  extraCams.set(p.id, { pub: p, media: stream });
  const tile = addTile(p.id, stream, name + " (tú)", true, () => 0);
  tile.querySelector(".name").after(el("button", { class: "small tileclose", onclick: () => { p.stop(); stream.getTracks().forEach((t) => t.stop()); extraCams.delete(p.id); tile.remove(); }, text: "✕" }));
  stream.getVideoTracks()[0].onended = () => { p.stop(); extraCams.delete(p.id); tile.remove(); };
}

$("#leaveBtn").onclick = () => leave("Saliste de la sala.");

function leave(text) {
  pub?.stop(); screenPub?.stop(); for (const x of extraCams.values()) x.pub.stop(); sig.close();
  media?.getTracks().forEach((t) => t.stop());
  // With #invite in the URL, a link to location.href is a same-document
  // navigation: it leaves this goodbye screen and the closed Signal in place.
  // A different query forces a fresh document while preserving the invitation.
  const back = new URL(location.href);
  back.searchParams.set("reenter", crypto.randomUUID());
  document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card col" }, el("h2", { text }), el("a", { class: "btn", href: back.href, text: "Volver a entrar" }))));
}

// Keyboard: M mic, V camera, hold Space = push-to-talk while muted (Discord style)
let ptt = false;
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) || !$("#call") || $("#call").classList.contains("hidden") || $("#devDialog")?.open) return;
  if (e.key === "m") setMic(!micOn());
  if (e.key === "v") setCam(!camOn());
  if (e.code === "Space" && !micOn() && !ptt) { ptt = true; setMic(true); e.preventDefault(); }
});
document.addEventListener("keyup", (e) => { if (e.code === "Space" && ptt) { ptt = false; setMic(false); } });

// ---------- chat ----------
function addChat(c) {
  const msg = chatMessage(c, { myId, myName: $("#name").value.trim() });
  appendChat($("#chatlog"), msg);
  if ($("#chat").classList.contains("hidden") && c.peerId !== myId) {
    $("#chatBtn").classList.add("on");
    if (msg.dataset.mention) toast(`${c.from} te mencionó en el chat`);
  }
}
const composer = mountComposer($("#chatInput").parentElement, $("#chatInput"), (x) => sig.send(x.sticker ? { type: "chat", kind: "sticker", text: x.sticker } : { type: "chat", text: x.text }));
$("#chatSend").onclick = composer.send;
$("#chatInput").addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && composer.send());

function fly(e) {
  const n = el("div", { class: "reaction-fly", text: e });
  n.style.left = 20 + Math.random() * 60 + "vw";
  document.body.append(n);
  setTimeout(() => n.remove(), 2500);
}

window.addEventListener("beforeunload", () => savePrefs(prefs));
