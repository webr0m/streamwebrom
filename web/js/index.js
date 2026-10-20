import { $, el, api, toast, readStored, writeStored } from "./rtc.js";
import { newVdoRoom, vdoHostPath, vdoRoomID } from "./vdo.js";

$("#roomEngine").onchange = () => {
  const vdo = $("#roomEngine").value === "vdo";
  $("#room").maxLength = vdo ? 32 : 48;
  document.querySelector('label[for="room"]').textContent = vdo ? "Prefijo de sala (opcional)" : "ID de sala (opcional)";
  $("#roomEngineHelp").textContent = vdo ? "Sala separada en la aplicación oficial de VDO.Ninja. Conserva nuestro marco visual, temas y accesos; sus controles de producción son propios. No usa el relé ni la cuota Cloudflare de este servidor. Al crearla se carga el servicio externo, sujeto a sus condiciones y privacidad." : "Nuestro estudio completo, con relé local. El anfitrión puede habilitar Cloudflare desde una sala con contraseña.";
  $("#lobby").disabled = vdo;
};

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
    if ($("#roomEngine").value === "vdo") {
      const config = newVdoRoom($("#room").value.trim().toLowerCase(), $("#pw").value, $("#title").value.trim());
      const rooms = readStored("swr.vdoRooms",{},true); rooms[config.room] = config;
      writeStored("swr.vdoRooms",rooms,true);
      location.href = vdoHostPath(config); return;
    }
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
const vdoRecent = Object.values(readStored("swr.vdoRooms",{},true)).filter(r => {
  try { return !!(r && r.directorKey && r.password && vdoRoomID(r.room) && vdoHostPath(r)); } catch { return false; }
}).sort((a,b) => b.created-a.created).slice(0,5);
if (vdoRecent.length) $("#recent").append(el("h3",{text:"VDO.Ninja · esta sesión del navegador"}),...vdoRecent.map(r => el("div",{class:"studio-card"},el("strong",{class:"grow",text:r.title || r.room}),el("a",{class:"btn small",href:vdoHostPath(r),text:"Abrir sala VDO.Ninja"}))));
