import { $, el, toast, params, api, Signal, publish, subscribe, levelMeter } from "./rtc.js";

const room = (params.get("room") || "").toLowerCase();
if (!room) location.href = "/";
let media = null, pub = null, screenPub = null, screenMedia = null;
let state = {};
const remotes = new Map(); // streamId -> { tile, sub, level }
const sig = new Signal();
let myId = "";

$("#name").value = localStorage.getItem("swr.name") || "";

// ---------- pre-join ----------
api(`/api/rooms/${encodeURIComponent(room)}`).then((r) => {
  $("#roomTitle").textContent = r.title ? `Unirse a “${r.title}”` : "Unirse al programa";
  $("#pwBox").classList.toggle("hidden", !r.password);
}).catch(() => { $("#roomTitle").textContent = "Esta sala no existe o ya terminó"; $("#joinBtn").disabled = true; });

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  for (const [sel, kind] of [["#cam", "videoinput"], ["#mic", "audioinput"]]) {
    const s = $(sel), cur = s.value;
    s.replaceChildren(...devs.filter((d) => d.kind === kind).map((d, i) => el("option", { value: d.deviceId, text: d.label || `${kind} ${i + 1}` })));
    if (kind === "videoinput") s.append(el("option", { value: "none", text: "Sin cámara" }));
    if (cur) s.value = cur;
  }
}

function constraints() {
  const q = Number($("#quality").value);
  const cam = $("#cam").value, mic = $("#mic").value, ns = $("#ns").checked;
  return {
    video: cam === "none" ? false : { deviceId: cam ? { exact: cam } : undefined, width: { ideal: q * 16 / 9 }, height: { ideal: q }, frameRate: { ideal: 30 } },
    audio: { deviceId: mic ? { exact: mic } : undefined, echoCancellation: ns, noiseSuppression: ns, autoGainControl: true, channelCount: 1 },
  };
}

let meterTimer;
async function startPreview() {
  media?.getTracks().forEach((t) => t.stop());
  try {
    media = await navigator.mediaDevices.getUserMedia(constraints());
  } catch (e) {
    toast("No se pudo abrir cámara/micrófono: " + e.message, "err");
    media = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => new MediaStream());
  }
  $("#preview").srcObject = media;
  await listDevices();
  clearInterval(meterTimer);
  const lvl = levelMeter(media);
  meterTimer = setInterval(() => { $("#meter").style.width = Math.round(lvl() * 100) + "%"; }, 80);
}
["#cam", "#mic", "#quality", "#ns"].forEach((s) => $(s).addEventListener("change", startPreview));
startPreview();

$("#joinBtn").onclick = async () => {
  const name = $("#name").value.trim();
  if (!name) return toast("Escribe tu nombre", "err");
  localStorage.setItem("swr.name", name);
  $("#joinBtn").disabled = true;
  try {
    const m = await sig.connect({ type: "join", room, role: "guest", name, password: $("#pw").value });
    if (m.type === "waiting") { $("#pre").classList.add("hidden"); $("#waiting").classList.remove("hidden"); return; }
    await enter(m);
  } catch (e) {
    toast(e.message, "err");
    $("#joinBtn").disabled = false;
  }
};

sig.on("welcome", (m) => { if (!$("#waiting").classList.contains("hidden")) enter(m); });
sig.on("denied", () => { document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card" }, el("h2", { text: "El anfitrión no aprobó tu ingreso." })))); });
sig.on("kicked", () => { sig.close(); leave("El anfitrión te retiró de la sala."); });
sig.on("reconnected", async (m) => { myId = m.peerId; if (media) pub = await publish(sig, media, { kind: "camera", name: $("#name").value, videoKbps: kbps() }).catch(() => null); });

const kbps = () => ({ 360: 800, 720: 2500, 1080: 4500 })[$("#quality").value] || 2500;

async function enter(m) {
  myId = m.peerId;
  state = m.state || {};
  $("#pre").classList.add("hidden"); $("#waiting").classList.add("hidden"); $("#call").classList.remove("hidden");
  clearInterval(meterTimer);
  addTile("me", media, $("#name").value + " (tú)", true, levelMeter(media));
  if (media.getTracks().length) {
    pub = await publish(sig, media, { kind: "camera", name: $("#name").value, videoKbps: kbps() });
  }
  sendMedia();
  for (const s of m.streams || []) watch(s.id, s.kind, s.owner);
  for (const c of m.chat || []) addChat(c);
  updateStageBadge();
}

// ---------- remote media ----------
sig.on("stream-added", (m) => watch(m.info.id, m.info.kind, m.info.owner, m.name));
sig.on("stream-removed", (m) => unwatch(m.stream));
sig.on("state", (m) => { state = m.state; updateStageBadge(); });
sig.on("chat", (m) => addChat(m.comment));
sig.on("reaction", (m) => fly(m.text));
sig.on("request", (m) => {
  if (m.action === "mute") { setMic(false); toast("El anfitrión silenció tu micrófono"); }
  if (m.action === "unmute") toast("El anfitrión te pide activar tu micrófono (M)");
});
sig.on("error", (m) => toast(m.error, "err"));

async function watch(id, kind, owner, name) {
  if (kind === "program" || owner === myId || remotes.has(id)) return;
  remotes.set(id, {});
  try {
    const sub = await subscribe(sig, id);
    const lvl = sub.stream.getAudioTracks().length ? levelMeter(sub.stream) : () => 0;
    remotes.set(id, { sub, tile: addTile(id, sub.stream, sub.name || name || "Invitado", false, lvl) });
  } catch { remotes.delete(id); }
}
function unwatch(id) {
  const r = remotes.get(id);
  r?.sub?.close(); r?.tile?.remove();
  remotes.delete(id);
}

function addTile(id, stream, name, mine, level) {
  const v = el("video", { playsinline: true, autoplay: true });
  v.muted = mine; v.srcObject = stream;
  if (mine) v.style.transform = "scaleX(-1)";
  v.play().catch(() => { document.addEventListener("click", () => v.play(), { once: true }); });
  const tile = el("div", { class: "tile", "data-id": id }, v, el("span", { class: "name", text: name }));
  $("#grid").append(tile);
  const t = setInterval(() => { if (!tile.isConnected) return clearInterval(t); tile.classList.toggle("speaking", level() > 0.15); }, 150);
  return tile;
}

function updateStageBadge() {
  const live = pub && (state.stage || []).includes(pub.id);
  const b = $("#stageState");
  b.textContent = live ? (state.live ? "EN VIVO" : "en escenario") : "backstage";
  b.className = "pill " + (live ? "red" : "");
}

// ---------- controls ----------
function setMic(on) {
  media?.getAudioTracks().forEach((t) => (t.enabled = on));
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
function sendMedia() { sig.send({ type: "media", mic: micOn(), cam: camOn() }); }

$("#micBtn").onclick = () => setMic(!micOn());
$("#camBtn").onclick = () => setCam(!camOn());
$("#handBtn").onclick = () => { sig.send({ type: "hand" }); $("#handBtn").classList.toggle("on"); };
$("#chatBtn").onclick = () => $("#chat").classList.toggle("hidden");
$("#reactBtn").onclick = () => $("#reactions").classList.toggle("hidden");
for (const e of ["👏", "❤️", "😂", "🔥", "🎉", "👍"]) $("#reactions").append(el("button", { class: "small", onclick: () => sig.send({ type: "reaction", text: e }), text: e }));
$("#screenBtn").onclick = async () => {
  if (screenPub) { screenPub.stop(); screenMedia.getTracks().forEach((t) => t.stop()); screenPub = null; $("#screenBtn").classList.remove("on"); return; }
  try {
    screenMedia = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    screenPub = await publish(sig, screenMedia, { kind: "screen", name: $("#name").value + " · pantalla", videoKbps: 5000, contentHint: "detail" });
    $("#screenBtn").classList.add("on");
    screenMedia.getVideoTracks()[0].onended = () => { screenPub?.stop(); screenPub = null; $("#screenBtn").classList.remove("on"); };
  } catch (e) { if (e.name !== "NotAllowedError") toast(e.message, "err"); }
};
$("#leaveBtn").onclick = () => leave("Saliste de la sala.");

function leave(text) {
  pub?.stop(); screenPub?.stop(); sig.close();
  media?.getTracks().forEach((t) => t.stop());
  document.body.replaceChildren(el("div", { class: "landing" }, el("div", { class: "card col" }, el("h2", { text }), el("a", { class: "btn", href: location.href, text: "Volver a entrar" }))));
}

// Keyboard: M mic, V camera, hold Space = push-to-talk while muted (Discord style)
let ptt = false;
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) || $("#call").classList.contains("hidden")) return;
  if (e.key === "m") setMic(!micOn());
  if (e.key === "v") setCam(!camOn());
  if (e.code === "Space" && !micOn() && !ptt) { ptt = true; setMic(true); e.preventDefault(); }
});
document.addEventListener("keyup", (e) => { if (e.code === "Space" && ptt) { ptt = false; setMic(false); } });

// ---------- chat ----------
function addChat(c) {
  const box = $("#chatlog");
  box.append(el("div", { class: "msg" }, el("b", { text: c.from }), " ", el("span", { text: c.text })));
  box.scrollTop = box.scrollHeight;
  if ($("#chat").classList.contains("hidden")) $("#chatBtn").classList.add("on");
}
const send = () => { const i = $("#chatInput"); if (i.value.trim()) sig.send({ type: "chat", text: i.value }); i.value = ""; };
$("#chatSend").onclick = send;
$("#chatInput").addEventListener("keydown", (e) => e.key === "Enter" && send());

function fly(e) {
  const n = el("div", { class: "reaction-fly", text: e });
  n.style.left = 20 + Math.random() * 60 + "vw";
  document.body.append(n);
  setTimeout(() => n.remove(), 2500);
}
