import { $, el, api, toast } from "./rtc.js";

const saved = () => {
  try {
    const rooms = JSON.parse(localStorage.getItem("swr.rooms") || "{}");
    return rooms && typeof rooms === "object" && !Array.isArray(rooms) ? rooms : {};
  } catch { return {}; }
};

$("#create").addEventListener("click", async () => {
  const btn = $("#create");
  btn.disabled = true;
  try {
    if (new TextEncoder().encode($("#pw").value).length > 72) throw new Error("La contraseña admite hasta 72 bytes (los acentos y emojis ocupan más de uno).");
    const keys = await api("/api/rooms", {
      room: $("#room").value.trim().toLowerCase(),
      title: $("#title").value.trim(),
      password: $("#pw").value,
      lobby: $("#lobby").checked,
    });
    const all = saved();
    all[keys.room] = { ...keys, title: $("#title").value.trim(), created: Date.now() };
    try { localStorage.setItem("swr.rooms", JSON.stringify(all)); }
    catch { toast("No se pudo guardar el estudio en este navegador. Guarda el enlace del anfitrión."); }
    // The host key travels in the fragment: never sent to servers or logged.
    location.href = `/studio?room=${encodeURIComponent(keys.room)}#key=${encodeURIComponent(keys.hostKey)}`;
  } catch (e) {
    toast(e.message, "err");
    btn.disabled = false;
  }
});

const join = () => {
  const r = $("#joinRoom").value.trim().toLowerCase();
  if (r) location.href = `/guest?room=${encodeURIComponent(r)}`;
};
$("#join").addEventListener("click", join);
$("#joinRoom").addEventListener("keydown", (e) => e.key === "Enter" && join());

const rooms = Object.values(saved()).filter(r=>r && typeof r.room === "string" && typeof r.hostKey === "string").sort((a,b)=>b.created-a.created);
function studioCard(r) {
  const expired = r.persistent && r.expires && r.expires < Date.now();
  return el("div",{class:"studio-card"},
    el("div",{class:"grow"},el("strong",{text:r.title || r.room}),el("span",{class:"muted",text:expired ? "Caducada" : r.persistent ? (r.expires ? "Guardada hasta " + new Date(r.expires).toLocaleDateString() : "Sin caducidad") : "Sala temporal"})),
    el("a",{class:"btn small",href:`/studio?room=${encodeURIComponent(r.room)}#key=${encodeURIComponent(r.hostKey)}`,text:"Abrir estudio"}));
}
const persistent=rooms.filter(r=>r.persistent);
if (persistent.length) $("#savedStudios").append(el("h3",{text:"Salas guardadas"}),...persistent.map(studioCard));
const recent=rooms.filter(r=>!r.persistent).slice(0,5);
if (recent.length) $("#recent").append(el("h3",{text:"Estudios recientes"}),...recent.map(studioCard));
