import { $, copy, readStored, writeStored, toast } from "./rtc.js";
import { VDO_ORIGIN, vdoRoomID, vdoRoomLinks, vdoHostPath } from "./vdo.js";
import { immersive } from "./immersive.js";

const query = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.slice(1));
const requestedRoom = query.get("room") || "", guest = query.get("role") === "guest";
const stored = readStored("swr.vdoRooms",{},true);
const config = { room:requestedRoom, password:fragment.get("p") || stored[requestedRoom]?.password || "", directorKey:guest ? "" : fragment.get("directorKey") || stored[requestedRoom]?.directorKey || "", title:fragment.get("title") || stored[requestedRoom]?.title || "Sala VDO.Ninja", created:stored[requestedRoom]?.created || Date.now() };
let cinema;
const frames = [];
function frame(url, title, mount, capture = false) {
  const f = document.createElement("iframe"); f.title = title; f.referrerPolicy = "no-referrer";
  f.allow = "autoplay; fullscreen; picture-in-picture" + (capture ? "; camera; microphone; display-capture" : "");
  f.src = url;
  if (!capture) f.onload = () => f.contentWindow?.postMessage({ mute:true },VDO_ORIGIN);
  $(mount).append(f); frames.push(f); return f;
}
try {
  const room = vdoRoomID(requestedRoom);
  config.room = room;
  const links = vdoRoomLinks(config);
  if (!guest) {
    if (!links.host) throw new Error("Falta el enlace privado del anfitrión. Abre el enlace que guardaste al crear la sala.");
    stored[room] = config;
    if (room !== requestedRoom) delete stored[requestedRoom];
    if (writeStored("swr.vdoRooms",stored,true)) history.replaceState(null,"",`/vdo?room=${encodeURIComponent(room)}`);
  }
  $("#vdoRoomTitle").textContent = config.title; $("#vdoRoomID").textContent = room;
  $("#vdoRoomStatus").textContent = guest ? "Invitado · concede permiso a tu cámara en la aplicación de abajo." : "Sala independiente · incorpora invitados desde los controles de producción.";
  $("#vdoDirectorSection").classList.toggle("hidden",guest);
  $("#vdoHostActions").classList.toggle("hidden",guest);
  frame(guest ? links.guest : links.scene, guest ? "Participar en VDO.Ninja" : "Escenario VDO.Ninja", "#vdoSceneMount", guest);
  if (!guest) frame(links.host,"Director de VDO.Ninja","#vdoDirectorMount",true);
  $("#vdoDirect").href = guest ? links.guest : links.host;
  $("#vdoRoomInvite").onclick = () => copy(`${location.origin}/vdo?room=${encodeURIComponent(room)}&role=guest#${new URLSearchParams({p:config.password,title:config.title})}`);
  $("#vdoRoomOBS").onclick = () => copy(links.scene);
  $("#vdoRoomHostLink").onclick = () => copy(location.origin + vdoHostPath(config));
  cinema = immersive($("#vdoStage"),$("#vdoRoomFullscreen"),$("#vdoExitFullscreen"));
} catch(e) { $("#vdoRoomStatus").textContent = e.message; toast(e.message,"err"); }
$("#vdoRoomSidebar").onclick = () => {
  const hidden = $("#vdoRoomSide").classList.toggle("hidden");
  $("#vdoRoomRoot").classList.toggle("sidebar-hidden",hidden); $("#vdoRoomSidebar").setAttribute("aria-expanded",String(!hidden));
};
$("#vdoLeave").onclick = () => { for (const f of frames) f.remove(); location.href = "/"; };
window.addEventListener("pagehide",() => { cinema?.destroy(); for(const f of frames) f.remove(); });
