// Interoperability with the unmodified official hosted application. No
// VDO.Ninja code, TURN credentials, or private signalling is redistributed.
export const VDO_ORIGIN = "https://vdo.ninja";

export function vdoLinks(id, password = "") {
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(id) || (password && !/^[a-zA-Z0-9]{1,49}$/.test(password))) throw new Error("Identificador o contraseña VDO.Ninja inválido (contraseña: hasta 49 letras y números)");
  const link = mode => {
    const u = new URL(VDO_ORIGIN + "/");
    u.searchParams.set(mode, id);
    if (password) u.hash = new URLSearchParams({ p: password }).toString();
    if (mode === "view") { u.searchParams.set("cleanoutput", ""); u.searchParams.set("autostart", ""); }
    return u.href;
  };
  return { publisher: link("push"), viewer: link("view") };
}

export function parseVdoView(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error("Pega un enlace de visualización de https://vdo.ninja/"); }
  if (u.origin !== VDO_ORIGIN || u.pathname !== "/" || u.username || u.password || !u.searchParams.get("view")) throw new Error("Solo se admiten enlaces de visualización del sitio oficial https://vdo.ninja/");
  // Rebuild using only the documented camera/view options. Never accept
  // arbitrary frame destinations, injected scripts or custom TURN endpoints.
  const secret = new URLSearchParams(u.hash.slice(1));
  return vdoLinks(u.searchParams.get("view"), secret.get("p") || secret.get("password") || u.searchParams.get("password") || "");
}

export function newVdoLinks() {
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,"0")).join("");
  return vdoLinks(token(), token());
}

export function newVdoRoom(prefix = "", password = "", title = "") {
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,"0")).join("");
  if (password && !/^[a-zA-Z0-9]{1,49}$/.test(password)) throw new Error("VDO.Ninja requiere una contraseña de 1 a 49 letras y números, sin espacios ni acentos.");
  if (prefix && !/^[a-z0-9_-]{3,32}$/.test(prefix)) throw new Error("El prefijo VDO admite 3 a 32 letras minúsculas, números, guion y guion bajo.");
  return { room: (prefix ? prefix + "-" : "swr-") + token(), password: password || token(), directorKey: token(), title: title.slice(0,120), created:Date.now() };
}

export function vdoRoomLinks(config) {
  const { room, password, directorKey } = config;
  if (!/^[a-z0-9_-]{6,65}$/.test(room) || !/^[a-zA-Z0-9]{1,49}$/.test(password || "")) throw new Error("Enlace de sala VDO.Ninja incompleto o inválido");
  const link = role => {
    const u = new URL(VDO_ORIGIN + "/"), secret = new URLSearchParams({ p:password });
    if (role === "host") {
      if (!/^[a-f0-9]{32}$/.test(directorKey || "")) throw new Error("Falta la clave del anfitrión VDO.Ninja");
      u.searchParams.set("director",room); secret.set("codirector",directorKey);
    } else {
      u.searchParams.set("room",room);
      if (role === "scene") { u.searchParams.set("scene","1"); u.searchParams.set("cleanoutput",""); u.searchParams.set("autostart",""); }
    }
    u.hash = secret.toString(); return u.href;
  };
  return { guest:link("guest"), scene:link("scene"), ...(directorKey ? { host:link("host") } : {}) };
}

export function vdoHostPath(config) {
  if (!vdoRoomLinks(config).host) throw new Error("Falta la clave del anfitrión VDO.Ninja");
  return `/vdo?room=${encodeURIComponent(config.room)}#${new URLSearchParams({ p:config.password, directorKey:config.directorKey, title:config.title || "" })}`;
}

export function mountVdo({ root, onCapture, copy, notify }) {
  const get = id => root.querySelector("#" + id);
  let frame = null, links = null, captureBusy = false;
  const clearFrame = () => { frame?.remove(); frame = null; get("vdoPreview").replaceChildren(); get("vdoPreview").classList.add("hidden"); };
  function connect(next) {
    clearFrame(); links = next;
    get("vdoURL").value = links.viewer;
    frame = document.createElement("iframe");
    frame.title = "Vista externa de VDO.Ninja";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.src = links.viewer;
    frame.onload = () => frame?.contentWindow?.postMessage({ mute: true }, VDO_ORIGIN);
    get("vdoPreview").append(frame); get("vdoPreview").classList.remove("hidden");
    for (const id of ["vdoCopyInvite", "vdoOpenView", "vdoCopyOBS"]) get(id).disabled = false;
    get("vdoCapture").disabled = !navigator.mediaDevices?.getDisplayMedia;
    get("vdoCaptureHelp").textContent = navigator.mediaDevices?.getDisplayMedia ? "Para llevar esta cámara al escenario, abre el visor y captura su pestaña. Selecciona también «Compartir audio»." : "Este navegador permite la vista previa y el enlace OBS. Para incorporar la cámara al escenario, abre el estudio desde un computador que permita capturar pestañas.";
  }
  get("vdoNew").onclick = () => connect(newVdoLinks());
  get("vdoConnect").onclick = () => { try { connect(parseVdoView(get("vdoURL").value)); } catch(e) { notify(e.message); } };
  get("vdoCopyInvite").onclick = () => links && copy(links.publisher);
  get("vdoCopyOBS").onclick = () => links && copy(links.viewer);
  get("vdoOpenView").onclick = () => links && window.open(links.viewer,"_blank","noopener,noreferrer");
  get("vdoCapture").onclick = async () => {
    if (!links || captureBusy) return;
    captureBusy = true; get("vdoCapture").disabled = true;
    try { await onCapture(); } catch(e) { notify(e.message); }
    finally { captureBusy = false; get("vdoCapture").disabled = !navigator.mediaDevices?.getDisplayMedia; }
  };
  get("vdoClose").onclick = () => root.close();
  root.addEventListener("close", clearFrame);
  return { destroy: clearFrame };
}
