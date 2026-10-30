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
import { $, el, toast, params, api, Signal, publish, subscribe, levelMeter, staleRevision } from "./rtc.js";
import { listDevices, loadPrefs, savePrefs, openMedia, renderPanel, cameraControls, applySink, onDeviceChange, settingsDialog, kbpsFor, explain } from "./devices.js";
import { remoteSnapshot, remoteStats, CAMCTL } from "./remote.js";
import { chatMessage, appendChat, mountComposer } from "./chat.js";
import { automaticRoute } from "./network.js";
import { callGrid } from "./call-grid.js";
import { roomTelemetry, metricText } from "./telemetry.js";
import { immersive } from "./immersive.js";
import { RoomAudio, pictureInPicture } from "./room-audio.js";
import { screenAudioNotice, resumeCaptureAudio, stopScreenCapture } from "./devices.js";
import { chooseScreen } from "./screen-share.js";
import { installI18n, t, onLangChange } from "./i18n.js";

installI18n();

const room = (params.get("room") || "").toLowerCase();
if (!room) location.href = "/";
const prefs = loadPrefs();
let media = new MediaStream(), pub = null, screenPub = null, screenMedia = null;
let screenAllowed = false, screenPending = false, screenOpening = false, screenAttempt = 0, screenNotice = "";
const extraCams = new Map(); // pubId -> { pub, media }
let state = {};
const remotes = new Map(); // streamId -> { tile, sub, video }
const remoteInfo = new Map(), remoteRetries = new Map();
const roomAudio = new RoomAudio(blocked => $("#enableAudio")?.classList.toggle("hidden", !blocked));
$("#enableAudio").onclick = () => roomAudio.resume();
const closePiP = pictureInPicture($("#floatingVideo"), () => $("#grid .tile.expanded video") || $('#grid .tile:not([data-id="me"]) video') || $('#grid [data-id="me"] video'), text => toast(text));
const sig = new Signal();
const cinema = immersive($("#call"), $("#callFullscreen"), $("#exitFullscreen"));
const telemetry = roomTelemetry(sig, () => pub?.pc, $("#roomPing"), peers => {
  for (const tile of document.querySelectorAll("#grid .tile")) {
    const label = tile.querySelector(".tile-latency");
    if (label) label.textContent = metricText(peers.get(tile.dataset.peer));
  }
});
$("#networkToggle").onclick = () => {
  const hidden = $("#call").classList.toggle("network-hidden");
  $("#networkToggle").setAttribute("aria-pressed", String(!hidden));
};
const gridLayout = callGrid($("#grid"), $("#restoreGrid"), $("#reorderGrid"));
// Even previously shared links start automatically. Manual routing is an
// optional advanced action for this visit, never required for admission.
sig.mediaMode = "auto";
sig.followRoomRoute = true;
$("#networkMode").value = sig.mediaMode;
function selectNetwork(mode) {
  sig.followRoomRoute = mode === "auto";
  $("#networkMode").value = mode;
  const url = new URL(location.href);
  if (mode === "auto") url.searchParams.delete("network"); else url.searchParams.set("network", mode);
  history.replaceState(null, "", url);
  sig.useNetwork(mode);
  if (entered) connectionStatus(t("guest.switchingRoute"), "guest.switchingRoute");
}
$("#networkMode").onchange = () => selectNetwork($("#networkMode").value);
let myId = "";

let savedName = "";
try { savedName = localStorage.getItem("swr.name") || ""; } catch {}
$("#name").value = params.get("label") || params.get("name") || savedName;
if (params.get("password") || params.get("pw")) $("#pw").value = params.get("password") || params.get("pw");

// ---------- pre-join ----------
let roomTitle = "", roomGone = false, joinLabelKey = "guest.join";
function renderRoomTitle() {
  const node = $("#roomTitle");
  if (!node) return;
  if (roomGone) node.textContent = t("guest.roomMissing");
  else node.textContent = roomTitle ? t("guest.joinRoomTitle", { title: roomTitle }) : t("guest.joinTitle");
}
api(`/api/rooms/${encodeURIComponent(room)}`).then((r) => {
  roomTitle = r.title || "";
  renderRoomTitle();
  $("#pwBox").classList.toggle("hidden", !r.password);
}).catch(() => { roomGone = true; renderRoomTitle(); $("#joinBtn").disabled = true; });

let remoteKbps = 0; // set by the host (director) from the studio
const videoKbps = () => remoteKbps || Number(params.get("bitrate") || params.get("vb")) || kbpsFor(Number(prefs.quality));
const pubOpts = (name) => ({ kind: "camera", name, videoKbps: videoKbps(), fps: Number(prefs.fps) || 30, codec: prefs.codec, stereo: prefs.stereo, audioKbps: prefs.stereo ? 256 : 96 });

let meterTimer, noDeviceNotice = false;
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
  if (!media.getTracks().length && !$("#devWarn").textContent) { noDeviceNotice = true; $("#devWarn").textContent = t("guest.noDevices"); }
  $("#preview").srcObject = media; mirrorPreview($("#preview"));
  showMeter(media);
  await renderPanel($("#devPre"), prefs, onPrefChange);
  $("#camCtlPre").replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
}

async function onPrefChange(p, what) {
  if (what === "speaker") { for (const id of remotes.keys()) { const audio = roomAudio.get(id); if (audio) applySink(audio, p.speaker); } return; }
  if (what === "other") {
    mirrorPreview($("#preview"));
    const me = $('[data-id="me"] video'); if (me) mirrorPreview(me);
    return;
  }
  if (!entered) return startPreview();
  await swapDevices(what);
  if (!pub && !connectingMedia && sig.ws?.readyState === 1) await connectMedia();
}

/** Hot-swap camera or mic during the call (no reconnection, no renegotiation). */
async function swapDevices(what, quiet = false) {
  const kind = what === "video" ? "video" : "audio";
  const opened = await openMedia({ ...prefs, camera: kind === "video" ? prefs.camera : "none", mic: kind === "audio" ? prefs.mic : "none" });
  if (sig.closed) { opened.stream.getTracks().forEach(t => t.stop()); return; }
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
  if (!quiet) toast(kind === "video" ? t("guest.cameraSwitched") : t("guest.micSwitched"), "ok");
}

onDeviceChange(() => {
  if (sig.closed) return;
  const target = $("#devDialog")?.open ? $("#devPanel") : $("#pre").classList.contains("hidden") ? null : $("#devPre");
  if (target) renderPanel(target, prefs, onPrefChange);
});
const previewReady = startPreview().catch(e => { $("#devWarn").textContent = explain(e); });

$("#joinBtn").onclick = join;
async function join() {
  const name = $("#name").value.trim();
  if (!name) return toast(t("guest.enterName"), "err");
  try { localStorage.setItem("swr.name", name); } catch {}
  $("#joinBtn").disabled = true;
  $("#networkMode").disabled = true;
  try {
    await previewReady; // Permission can take longer than autostart's delay.
    if (sig.mediaMode === "auto") {
      const cfg = await api("/api/config");
      sig.mediaMode = await automaticRoute(cfg, mode => {
        joinLabelKey = mode === "local" ? "guest.checkingAlt" : "guest.checkingBest";
        $("#joinBtn").textContent = t(joinLabelKey);
      }, { room, password: $("#pw").value });
    }
    joinLabelKey = "guest.joining";
    $("#joinBtn").textContent = t(joinLabelKey);
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
    const m = await sig.connect({ type: "join", room, role: "guest", name, password: $("#pw").value, invite, rejoin: new URLSearchParams(location.hash.slice(1)).get("participant") || undefined });
    if (m.type === "waiting") { $("#pre").classList.add("hidden"); $("#waiting").classList.remove("hidden"); return; }
    await enter(m);
  } catch (e) {
    toast(e.message, "err");
    $("#joinBtn").disabled = false;
    $("#networkMode").disabled = false;
    joinLabelKey = "guest.join";
    $("#joinBtn").textContent = t(joinLabelKey);
  }
}
if ((params.has("autostart") || params.has("autojoin") || params.has("aj")) && $("#name").value) setTimeout(join, 800);

let entered = false, rewait = false;
let connectingMedia = false;
let mediaGeneration = 0;
let hadMediaConnection = false;
let lastConnectionKey = "";
function connectionStatus(text, key = "") {
  if (sig.closed) return;
  lastConnectionKey = key;
  // Initial entry only: weak signal, paused capture and transient ICE states
  // must never put a reconnect overlay over a live call.
  $("#connection").classList.toggle("hidden", hadMediaConnection || !text);
  $("#connectionText").textContent = text;
}
async function connectMedia() {
  if (connectingMedia) return;
  if (!media.getTracks().length) { connectionStatus(""); return; }
  const generation = ++mediaGeneration;
  connectingMedia = true;
  if (!hadMediaConnection) connectionStatus(t("guest.connectingMedia"), "guest.connectingMedia");
  try {
    pub?.stop(); pub = null;
    const fresh = await publish(sig, media, pubOpts($("#name").value));
    if (generation !== mediaGeneration) { fresh.stop(); return; }
    pub = fresh;
    unwatch(pub.id); // A rejoin snapshot can still contain our old stable ID.
    hadMediaConnection = true;
    connectionStatus(""); sendMedia(); updateStageBadge();
  } catch (e) { if (generation === mediaGeneration) connectionStatus(e.message); }
  finally { if (generation === mediaGeneration) connectingMedia = false; }
}
sig.on("disconnected", () => {
  ++mediaGeneration; connectingMedia = false;
  stopScreen(false);
  if (sig.closed) return;
  try { pub?.pc.close(); } catch {} pub = null;
  for (const id of [...remoteInfo.keys()]) unwatch(id);
  if (entered) connectionStatus("");
});
sig.on("welcome", (m) => {
  if (rewait) { rewait = false; $("#waiting").classList.add("hidden"); $("#call").classList.remove("hidden"); resume(m); return; }
  if (!entered && !$("#waiting").classList.contains("hidden")) enter(m);
});
sig.on("denied", () => { document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card" }, el("h2", { text: t("guest.deniedTitle") })))); });
sig.on("kicked", () => { sig.close(); leave(t("guest.kicked")); });
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
  const socket = sig.ws;
  // The server forgot our old publications: publish fresh ones.
  myId = m.peerId;
  const mine = $('[data-id="me"]'); if (mine) mine.dataset.peer = myId;
  state = m.state || state;
  // Clear only the old session before awaiting publication. A stream-added
  // received during negotiation belongs to the new session and must survive.
  for (const id of [...remoteInfo.keys()]) unwatch(id);
  for (const s of m.streams || []) watch(s.id, s.kind, s.owner, "", s.revision);
  try { pub?.pc.close(); } catch {}
  pub = null;
  await connectMedia();
  if (sig.closed || sig.ws !== socket) return;
  stopScreen(false); // A new connection needs a new host authorization.
  if (sig.closed || sig.ws !== socket) return;
  for (const [id, x] of [...extraCams]) {
    try { x.pub.pc.close(); } catch {}
    try {
      const fresh = await publish(sig, x.media, x.pub.opts);
      if (sig.closed || sig.ws !== socket || extraCams.get(id) !== x) { fresh.stop(); continue; }
      x.pub = fresh;
      if (fresh.id !== id) { extraCams.delete(id); extraCams.set(fresh.id,x); }
      if (x.tile) { x.tile.dataset.id = fresh.id; x.tile.dataset.peer = myId; }
    } catch (e) { if (!sig.closed && sig.ws === socket) toast(t("guest.extraCamFailed", { error: e.message }),"err"); }
  }
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
  addTile("me", media, $("#name").value + " " + t("guest.youBadge"), true, levelMeter(media));
  await connectMedia();
  if (sig.closed) return;
  setMic(micOn()); setCam(camOn());
  for (const s of m.streams || []) watch(s.id, s.kind, s.owner, "", s.revision);
  for (const c of m.chat || []) addChat(c);
  updateStageBadge();
  if (params.has("screenshare") || params.has("ss")) $("#screenBtn").click();
}

// ---------- remote media ----------
sig.on("stream-added", (m) => watch(m.info.id, m.info.kind, m.info.owner, m.name, m.info.revision));
sig.on("stream-updated", (m) => { if (staleRevision(m.info.revision, remoteInfo.get(m.info.id)?.revision)) return; unwatch(m.info.id); watch(m.info.id, m.info.kind, m.info.owner, m.name, m.info.revision); });
sig.on("stream-removed", (m) => { const current = remoteInfo.get(m.stream); if (m.revision && current?.revision && m.revision !== current.revision) return; unwatch(m.stream); });
sig.on("state", (m) => { state = m.state; updateStageBadge(); });
sig.on("screen-permission", screenPermission);
sig.on("chat", (m) => addChat(m.comment));
sig.on("reaction", (m) => fly(m.text));
sig.on("request", (m) => {
  switch (m.action) {
    case "mute": setMic(false); toast(t("guest.hostMutedMic")); break;
    case "unmute": ask(t("guest.hostAskUnmute"), t("guest.activate"), () => setMic(true)); break;
    case "camoff": setCam(false); toast(t("guest.hostCamOff")); break;
    case "camon": ask(t("guest.hostAskCamOn"), t("guest.turnOn"), () => setCam(true)); break;
    case "lowerhand": $("#handBtn").classList.remove("on"); break;
    case "screenoff": if (screenPub) stopScreen(); toast(t("guest.hostStoppedScreen")); break;
    case "screenon": toast(t("guest.screenNeedsApproval")); break;
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
      const extra = v?.stream ? extraCams.get(v.stream) : null;
      if (v?.stream && v.stream !== pub?.id && !extra) throw new Error(t("misc.guestCamGone"));
      const targetMedia = extra?.media || media, targetPrefs = extra ? { ...prefs } : prefs;
      const h = Number(v?.height), fps = Number(v?.fps), kbps = Number(v?.kbps);
      if (h && h >= 144 && h <= 2160) targetPrefs.quality = String(h);
      if (fps && fps >= 1 && fps <= 60) targetPrefs.fps = String(fps);
      const rate = kbps >= 50 && kbps <= 50000 ? Math.round(kbps) : kbpsFor(Number(targetPrefs.quality));
      if (!extra) remoteKbps = rate;
      const track = targetMedia.getVideoTracks()[0], raw = track?.raw || track;
      let ok = false;
      if (raw?.applyConstraints) {
        try { await raw.applyConstraints({ width: { ideal: Math.round(Number(targetPrefs.quality) * 16 / 9) }, height: { ideal: Number(targetPrefs.quality) }, frameRate: { ideal: Number(targetPrefs.fps) } }); ok = true; }
        catch (e) { console.warn("applyConstraints", e); }
      }
      if (!ok && raw) {
        if (extra) throw new Error(t("misc.guestCamNoResolution"));
        await swapDevices("video", true);
      }
      const targetPub = extra?.pub || pub;
      if (targetPub) await targetPub.setBitrate(rate, Number(targetPrefs.fps) || 30);
      if (!extra) savePrefs(prefs);
      toast(t("guest.hostAdjustedVideo", { quality: targetPrefs.quality, fps: targetPrefs.fps, rate }));
      return report("quality", { ...await remoteSnapshot(extra?.media || media, targetPrefs, { videoKbps: rate }), stream: targetPub?.id });
    }
    case "device": {
      const kind = v?.kind === "audio" ? "audio" : "video";
      const { cams, mics } = await listDevices();
      const list = kind === "video" ? cams : mics;
      if (!list.some((d) => d.deviceId === v?.deviceId)) throw new Error(t("misc.guestDeviceMissing"));
      if (kind === "video") prefs.camera = v.deviceId; else prefs.mic = v.deviceId;
      savePrefs(prefs);
      await swapDevices(kind, true);
      toast(kind === "video" ? t("guest.hostChangedCam") : t("guest.hostChangedMic"));
      return report("devices", await remoteSnapshot(media, prefs, { videoKbps: videoKbps() }));
    }
    case "camctl": {
      const track = camTrack();
      if (!track || !CAMCTL.includes(v?.name)) throw new Error(t("misc.guestCamControl"));
      await track.applyConstraints({ advanced: [{ [v.name]: v.value }] });
      return;
    }
    case "gain": {
      const g = Number(v);
      if (!(g >= 0 && g <= 400)) return;
      prefs.gain = Math.round(g); savePrefs(prefs);
      await swapDevices("audio", true);
      return toast(t("guest.hostAdjustedMic", { level: prefs.gain }));
    }
    case "audio": {
      for (const k of ["echo", "denoise", "autogain", "stereo"]) if (typeof v?.[k] === "boolean") prefs[k] = v[k];
      savePrefs(prefs);
      return swapDevices("audio", true);
    }
    case "deafen": case "undeafen":
      deafened = action === "deafen";
      for (const id of remotes.keys()) { const audio = roomAudio.get(id); if (audio) audio.muted = deafened; }
      return toast(deafened ? t("guest.deafenedNote") : t("guest.undeafenedNote"));
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
      toast(t("guest.transferringRoom"));
      sig.close(); pub?.stop();
      return setTimeout(() => location.replace(u.toString()), 600);
    }
  }
}

function showHostMessage(text) {
  if (!text) return;
  const box = el("div", { class: "hostmsg" }, el("b", { text: t("guest.hostMessageTitle") }), el("p", { text }), el("button", { class: "small primary", onclick: () => box.remove(), text: t("guest.understood") }));
  document.body.append(box);
  setTimeout(() => box.remove(), 30000);
}
sig.on("error", (m) => toast(m.error, "err"));

function ask(text, btn, fn) {
  // Privacy: the host can turn things off, but turning them on needs the guest's click.
  const box = el("div", { class: "toast ask" }, el("span", { text }), el("button", { class: "small primary", onclick: () => { fn(); box.remove(); }, text: btn }), el("button", { class: "small", onclick: () => box.remove(), text: t("guest.notNow") }));
  ($("#toasts") || document.body).append(box);
  setTimeout(() => box.remove(), 15000);
}

async function watch(id, kind, owner, name, revision) {
  if (kind === "program") return;
  if (owner === myId || id === pub?.id || id === screenPub?.id || extraCams.has(id)) { unwatch(id); return; }
  const previous = remoteInfo.get(id);
  if (staleRevision(revision, previous?.revision)) return;
  if (remotes.has(id) && (!revision || previous?.revision === revision)) return;
  if (remotes.has(id)) unwatch(id);
  remoteInfo.set(id, { kind, owner, name, revision });
  clearTimeout(remoteRetries.get(id)); remoteRetries.delete(id);
  const pending = { revision };
  remotes.set(id, pending);
  try {
    const sub = await subscribe(sig, id);
    if (remotes.get(id) !== pending) { sub.close(); return; }
    const lvl = sub.stream.getAudioTracks().length ? levelMeter(sub.stream) : () => 0;
    const tile = addTile(id, sub.stream, sub.name || name || t("guest.guestTile"), false, lvl, kind, owner);
    const entry = { sub, tile, level: lvl, video: tile.querySelector("video"), revision };
    remotes.set(id, entry);
  } catch { if (remotes.get(id) === pending) retryRemote(id, pending); }
}
function retryRemote(id, entry) {
  if (remotes.get(id) !== entry || sig.closed || !remoteInfo.has(id)) return;
  unwatch(id, false);
  remoteRetries.set(id, setTimeout(() => {
    remoteRetries.delete(id); const info = remoteInfo.get(id);
    if (info && sig.ready) watch(id, info.kind, info.owner, info.name, info.revision);
  }, 1000));
}
function unwatch(id, forget = true) {
  clearTimeout(remoteRetries.get(id)); remoteRetries.delete(id);
  const r = remotes.get(id);
  r?.stopWatch?.(); r?.sub?.close(); r?.level?.close?.(); r?.tile?.remove(); roomAudio.remove(id);
  remotes.delete(id);
  if (forget) remoteInfo.delete(id);
}

function addTile(id, stream, name, mine, level, kind = "camera", owner = "") {
  const v = el("video", { playsinline: true, autoplay: true });
  v.muted = true; v.srcObject = stream;
  if (mine) mirrorPreview(v); else applySink(v, prefs.speaker);
  v.play().catch(() => {});
  const audio = mine ? null : roomAudio.add(id, stream); if (audio) audio.muted = deafened;
  if (audio) applySink(audio, prefs.speaker);
  const vol = mine ? null : el("input", { type: "range", min: 0, max: 1, step: 0.05, value: 1, title: t("guest.volumeTitle"), class: "tilevol", oninput: (e) => { if (audio) audio.volume = Number(e.target.value); } });
  const tile = el("div", { class: "tile", "data-id": id, "data-name": name, "data-kind": kind, "data-peer": mine ? myId : owner }, v,
    el("span", { class: "tile-latency", title: t("guest.rttTitle"), text: t("guest.rttValue") }),
    el("button", { class: "tile-focus", type: "button", "aria-label": t("guest.focusAria", { name }), "aria-pressed": "false" }),
    el("span", { class: "name", text: name }), vol);
  $("#grid").append(tile); updateHiddenCameras(); telemetry.refresh();
  const speakingTimer = setInterval(() => { if (!tile.isConnected) return clearInterval(speakingTimer); tile.classList.toggle("speaking", level() > 0.15); }, 150);
  return tile;
}

function updateHiddenCameras() {
  for (const tile of document.querySelectorAll("#grid .tile")) {
    const id = tile.dataset.id === "me" ? pub?.id : tile.dataset.id;
    tile.classList.toggle("video-hidden", !!state.hidden?.[id]);
  }
}
function updateStageBadge() {
  updateHiddenCameras();
  const mine = [pub?.id, screenPub?.id, ...extraCams.keys()].filter(Boolean);
  const live = mine.some((id) => (state.stage || []).includes(id));
  const progMuted = state.stageMuted || mine.some((id) => state.muted?.[id]);
  const others = Object.entries(state.outputs || {}).filter(([, o]) => mine.some((id) => (o.stage || []).includes(id))).map(([n]) => n);
  const b = $("#stageState");
  if (!b) return;
  b.textContent = live
    ? (state.live ? (progMuted ? t("guest.stageLiveMuted") : t("guest.stageLive")) : progMuted ? t("guest.stageOnStageMuted") : t("guest.stageOnStage"))
    : others.length ? t("guest.stageOnStageOthers", { names: others.join(", ") }) : t("guest.stageBackstage");
  b.className = "pill " + (live ? "red" : "");
  renderScreenPermission();
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

function onLiveStage() {
  const mine = [pub?.id, screenPub?.id, ...extraCams.keys()].filter(Boolean);
  return [state.stage || [], ...Object.values(state.outputs || {}).map(o => o.stage || [])].some(ids => mine.some(id => ids.includes(id)));
}
function renderScreenPermission() {
  const button = $("#screenBtn"), box = $("#screenShareStatus");
  if (!button || !box) return;
  const supported = !!navigator.mediaDevices?.getDisplayMedia;
  const label = screenPub ? t("guest.screenStopTitle") : screenPending ? t("guest.screenCancelRequestTitle") : screenAllowed ? t("guest.screenAuthorizedTitle") : t("guest.screenRequestTitle");
  button.title = !supported ? t("guest.screenUnsupportedTitle") : !onLiveStage() ? t("guest.screenNeedsStageTitle") : label;
  button.setAttribute("aria-label", button.title);
  button.disabled = screenOpening || (!screenPub && !screenPending && (!onLiveStage() || !supported));
  button.classList.toggle("on", !!screenPub);
  const text = screenPub ? t("guest.screenSharingText") : screenPending ? t("guest.screenPendingText") : screenAllowed ? t("guest.screenAllowedText") : screenNotice;
  box.classList.toggle("hidden", !text);
  $("#screenShareText").textContent = text;
  $("#startScreen").classList.toggle("hidden", !screenAllowed || !!screenPub);
  $("#startScreen").disabled = screenOpening;
  $("#cancelScreen").textContent = screenPub ? t("guest.stop") : screenPending || screenAllowed ? t("guest.cancel") : t("guest.close");
}
function stopScreen(notify = true) {
  const active = screenAllowed || screenPending || screenPub || screenOpening;
  ++screenAttempt;
  screenAllowed = false; screenPending = false; screenOpening = false; screenNotice = "";
  screenPub?.stop(); stopScreenCapture(screenMedia);
  screenPub = null; screenMedia = null;
  if (notify && active && !sig.closed) sig.send({ type: "screen-cancel" });
  renderScreenPermission();
}
function screenPermission(m) {
  if (sig.closed) return;
  if (m.action === "pending") { screenPending = true; screenAllowed = false; }
  else if (m.action === "allowed") { ++screenAttempt; screenAllowed = true; screenPending = false; screenNotice = ""; }
  else {
    stopScreen(false);
    screenNotice = m.action === "denied" ? t("guest.screenDeniedNotice") : m.action === "revoked" ? t("guest.screenRevokedNotice") : "";
  }
  renderScreenPermission();
}
async function shareScreen() {
  if (screenPub || screenPending) return stopScreen();
  if (screenOpening) return;
  if (!onLiveStage()) return toast(t("guest.screenNeedsStageToast"));
  if (!navigator.mediaDevices?.getDisplayMedia) return toast(t("guest.screenUnsupportedToast"), "err");
  const attempt = screenAttempt;
  if (!screenAllowed) {
    screenPending = true; renderScreenPermission();
    try { const reply = await sig.request({ type: "screen-request" }); if (attempt === screenAttempt && !sig.closed) screenPermission(reply); }
    catch (e) { if (attempt === screenAttempt) { stopScreen(false); if (!sig.closed) toast(e.message, "err"); } }
    return;
  }
  screenOpening = true; renderScreenPermission();
  try {
    // This call must remain in the guest's own click: a host approval cannot
    // open the browser's display picker without a fresh user gesture.
    const opened = await chooseScreen();
    if (sig.closed || attempt !== screenAttempt || !screenAllowed || !onLiveStage()) { stopScreenCapture(opened); return; }
    screenMedia = opened;
    const publication = await publish(sig, opened, { kind: "screen", name: $("#name").value + " · " + t("guest.screenLabel"), videoKbps: 5000, contentHint: "detail", codec: prefs.codec, stereo: true, audioKbps: 192 });
    if (sig.closed || attempt !== screenAttempt || !screenAllowed) { publication.stop(); stopScreenCapture(opened); return; }
    screenPub = publication;
    opened.addEventListener('captureerror',e=>{stopScreen();toast(e.detail||t("guest.captureStopped"),"err")},{once:true});
    toast(screenAudioNotice(opened), opened.getAudioTracks().length ? "ok" : "");
    opened.getVideoTracks()[0].onended = () => stopScreen();
  } catch (e) { if (attempt === screenAttempt) { stopScreen(); if (!sig.closed && e.name !== "NotAllowedError" && e.name !== "AbortError") toast(explain(e), "err"); } }
  finally { if (attempt === screenAttempt) screenOpening = false; renderScreenPermission(); }
}
$("#screenBtn").onclick = shareScreen;
$("#startScreen").onclick = shareScreen;
$("#cancelScreen").onclick = () => stopScreen();

// A second (third…) camera from the same device, e.g. overhead cam or capture card.
$("#cam2Btn").onclick = async () => {
  const { cams } = await listDevices();
  const used = media.getVideoTracks()[0]?.getSettings().deviceId;
  const options = cams.filter((c) => c.deviceId !== used);
  if (!options.length) return toast(t("guest.noOtherCam"), "err");
  const dlg = el("dialog", { class: "card devdialog" },
    el("h3", { text: t("guest.addCamera") }),
    ...options.map((c, i) => el("button", { onclick: async () => { dlg.close(); dlg.remove(); await addExtraCam(c); }, text: c.label || t("guest.cameraNth", { n: i + 2 }) })),
    el("button", { class: "small", onclick: () => { dlg.close(); dlg.remove(); }, text: t("guest.cancel") }));
  document.body.append(dlg); dlg.showModal();
};
async function addExtraCam(dev) {
  const { stream, warnings } = await openMedia({ ...prefs, camera: dev.deviceId, mic: "none" });
  if (sig.closed) { stream.getTracks().forEach(t => t.stop()); return; }
  warnings.forEach((w) => toast(w, "err"));
  if (!stream.getVideoTracks().length) return;
  const name = `${$("#name").value} · ${(dev.label || t("guest.secondCamera")).slice(0, 24)}`;
  let slot=1; while ([...extraCams.values()].some(e=>e.slot===slot)) slot++;
  let p;
  try { p = await publish(sig, stream, { ...pubOpts(name), name, stream: "camera-slot-" + slot }); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); if (!sig.closed) toast(e.message, "err"); return; }
  const tile = addTile(p.id, stream, name + " " + t("guest.youBadge"), true, () => 0);
  const entry = { pub:p, media:stream, slot, tile };
  extraCams.set(p.id, entry);
  const close = () => { entry.pub.stop(); stream.getTracks().forEach(t => t.stop()); extraCams.delete(entry.pub.id); tile.remove(); };
  tile.querySelector(".name").after(el("button", { class: "small tileclose", onclick: close, text: "✕" }));
  stream.getVideoTracks()[0].onended = close;
}

$("#leaveBtn").onclick = () => leave(t("guest.leftRoom"));

function leave(text) {
  // Closing signalling first avoids queued unpublish operations delaying the
  // server's leave cleanup when a TURN connection takes time to shut down.
  sig.close(); pub?.stop(); screenPub?.stop(); for (const x of extraCams.values()) x.pub.stop();
  clearInterval(meterTimer); gridLayout.destroy(); telemetry.destroy(); cinema.destroy(); closePiP();
  for (const id of [...remoteInfo.keys()]) unwatch(id);
  roomAudio.close();
  stopScreenCapture(screenMedia);
  for (const x of extraCams.values()) x.media.getTracks().forEach(t => t.stop());
  media?.getTracks().forEach((t) => t.stop());
  // With #invite in the URL, a link to location.href is a same-document
  // navigation: it leaves this goodbye screen and the closed Signal in place.
  // A different query forces a fresh document while preserving the invitation.
  const back = new URL(location.href);
  back.searchParams.set("reenter", crypto.randomUUID());
  document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card col" }, el("h2", { text }), el("a", { class: "btn", href: back.href, text: t("guest.rejoin") }))));
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
    if (msg.dataset.mention) toast(t("guest.mentioned", { name: c.from }));
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

// Switching tabs is not leaving the room. Resume real media after OS/browser
// interruptions; never close a healthy socket merely because the page is hidden.
let foregroundRecovery = false;
async function resumeForeground() {
  if (document.visibilityState !== "visible" || !entered || sig.closed || foregroundRecovery) return;
  foregroundRecovery = true;
  try {
    roomAudio.resume(); resumeCaptureAudio(); levelMeter.ctx?.resume().catch(() => {});
    for (const video of document.querySelectorAll("#grid video")) video.play().catch(() => {});
    // Signal alone recovers after a real socket close. Foregrounding must not
    // replace an open/joining socket or race an existing recovery attempt.
    if (!sig.ready || sig.ws?.readyState !== 1) return;
    for (const kind of ["audio", "video"]) {
      const tracks = kind === "audio" ? media.getAudioTracks() : media.getVideoTracks();
      if (tracks.some(t => t.readyState === "ended")) await swapDevices(kind === "audio" ? "audio" : "video", true);
    }
  } catch (e) { if (!sig.closed) toast(t("guest.recoveryFailed", { error: explain(e) }), "err"); }
  finally { foregroundRecovery = false; }
}
document.addEventListener("visibilitychange", resumeForeground);
document.addEventListener("resume", resumeForeground);
window.addEventListener("pageshow", resumeForeground);
window.addEventListener("online", resumeForeground);

// Language switch: i18n rewrites the static markup, but these labels are built
// by this module, so they have to be redrawn against the new dictionary too.
function refreshDevicePanels() {
  const target = $("#devDialog")?.open ? $("#devPanel") : $("#pre").classList.contains("hidden") ? null : $("#devPre");
  if (target && target.children.length) renderPanel(target, prefs, onPrefChange);
  $("#camCtlPre").replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
  if (entered) $("#devCamCtl")?.replaceChildren(cameraControls(media.getVideoTracks()[0]) || "");
}
onLangChange(() => {
  renderRoomTitle();
  const joinBtn = $("#joinBtn");
  if (joinBtn) joinBtn.textContent = t(joinLabelKey);
  if ($("#devWarn") && noDeviceNotice) $("#devWarn").textContent = t("guest.noDevices");
  if ($("#connectionText") && lastConnectionKey) $("#connectionText").textContent = t(lastConnectionKey);
  if (entered) updateStageBadge();
  renderScreenPermission();
  refreshDevicePanels();
});
